"""Job manager: one conversion at a time, dedup by doc_id, blocking waits with heartbeat."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import gc
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import shutil
import time

from .config import DocError, Settings
from .options import ConvertOptions, file_sha256, make_doc_id
from .results import write_result

DOC_ID = re.compile(r"[0-9a-f]{16}")
HEARTBEAT_SECONDS = 15


def docling_version() -> str:
    return version("docling")


@dataclass
class JobStatus:
    doc_id: str
    status: str = "queued"
    stage: str = ""
    pages_done: int = 0
    pages_total: int = 0
    elapsed_seconds: float = 0.0
    code: str | None = None
    message: str | None = None
    result: dict | None = None


class JobManager:
    def __init__(self, settings: Settings, converter, models, clock=time.monotonic, heartbeat_seconds: float = HEARTBEAT_SECONDS):
        self.settings = settings
        self.converter = converter
        self.models = models
        self.clock = clock
        self.heartbeat_seconds = heartbeat_seconds
        self.docs_dir = settings.data_dir / "docs"
        self.docs_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._jobs: dict[str, JobStatus] = {}
        self._started: dict[str, float] = {}
        self._events: dict[str, asyncio.Event] = {}
        self._queue: asyncio.Queue | None = None
        self._worker: asyncio.Task | None = None

    # -- paths and status files
    def folder(self, doc_id: str) -> Path:
        if not DOC_ID.fullmatch(doc_id):
            raise DocError("not_found", "unknown doc_id")
        return self.docs_dir / doc_id

    def _write_status(self, doc_id: str, job: JobStatus, **extra) -> None:
        folder = self.docs_dir / doc_id
        folder.mkdir(parents=True, exist_ok=True)
        data = {k: v for k, v in vars(job).items() if k != "elapsed_seconds"} | extra
        old = self._read_status_file(doc_id)
        data = {k: v for k, v in old.items() if k not in data} | data
        tmp = folder / "status.json.tmp"
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, folder / "status.json")

    def _read_status_file(self, doc_id: str) -> dict:
        try:
            return json.loads((self.docs_dir / doc_id / "status.json").read_text())
        except (OSError, ValueError):
            return {}

    # -- public api
    async def convert(self, source: Path, options: ConvertOptions,
                      heartbeat: Callable[[JobStatus], Awaitable[None]]) -> JobStatus:
        if self.models.state != "ready":
            raise DocError("warming_up", "models are still downloading", retry_after_seconds=30)
        sha = await asyncio.to_thread(file_sha256, source)
        doc_id = make_doc_id(sha, source.suffix, options, docling_version())
        job = self._jobs.get(doc_id)
        if job is None or job.status in ("done", "failed"):
            existing = self._read_status_file(doc_id)
            if (self.docs_dir / doc_id / "INDEX.md").exists() and existing.get("status") == "done":
                return JobStatus(doc_id, "done", result=existing.get("result"))
            self._enqueue(doc_id, source, options)
        return await self._wait(doc_id, heartbeat)

    def job(self, doc_id: str) -> JobStatus:
        self.folder(doc_id)
        live = self._jobs.get(doc_id)
        if live is not None:
            return replace(live, elapsed_seconds=self._elapsed(doc_id))
        data = self._read_status_file(doc_id)
        if not data:
            raise DocError("not_found", "unknown doc_id")
        return JobStatus(doc_id, data["status"], data.get("stage", ""), data.get("pages_done", 0), data.get("pages_total", 0),
                         0.0, data.get("code"), data.get("message"), data.get("result"))

    def recover(self) -> None:
        for folder in self.docs_dir.iterdir():
            data = self._read_status_file(folder.name)
            if data.get("status") in ("queued", "running"):
                job = JobStatus(folder.name, "failed", data.get("stage", ""), code="service_restarted",
                                message="the service restarted while this job was running; repeat the call")
                self._write_status(folder.name, job)

    def delete(self, doc_id: str) -> None:
        folder = self.folder(doc_id)
        live = self._jobs.get(doc_id)
        if live is not None and live.status in ("queued", "running"):
            raise DocError("job_running", "a job for this doc_id is still running")
        if not folder.exists():
            raise DocError("not_found", "unknown doc_id")
        shutil.rmtree(folder)
        self._jobs.pop(doc_id, None)

    def list(self) -> list[dict]:
        rows = []
        for folder in sorted(self.docs_dir.iterdir()):
            data = self._read_status_file(folder.name)
            if data.get("status") != "done":
                continue
            rows.append({"doc_id": folder.name, "source_name": data.get("source_name"),
                         "pages": (data.get("result") or {}).get("counts", {}).get("pages"),
                         "converted_at": data.get("finished"), "bytes": _folder_bytes(folder)})
        return rows

    def sweep(self) -> int:
        cutoff = time.time() - self.settings.retention_days * 86400
        removed = 0
        for folder in list(self.docs_dir.iterdir()):
            live = self._jobs.get(folder.name)
            if live is not None and live.status in ("queued", "running"):
                continue
            status = folder / "status.json"
            stamp = status.stat().st_mtime if status.exists() else folder.stat().st_mtime
            if stamp < cutoff:
                shutil.rmtree(folder)
                self._jobs.pop(folder.name, None)
                removed += 1
        return removed

    def queue_state(self) -> dict:
        live = [j for j in self._jobs.values() if j.status in ("queued", "running")]
        return {"running": [j.doc_id for j in live if j.status == "running"],
                "queued": [j.doc_id for j in live if j.status == "queued"]}

    # -- internals
    def _elapsed(self, doc_id: str) -> float:
        start = self._started.get(doc_id)
        return round(self.clock() - start, 1) if start is not None else 0.0

    def _enqueue(self, doc_id: str, source: Path, options: ConvertOptions) -> None:
        if self._queue is None:
            self._queue = asyncio.Queue(maxsize=self.settings.max_queue)
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._work())
        job = JobStatus(doc_id)
        try:
            self._queue.put_nowait((doc_id, source, options))
        except asyncio.QueueFull:
            raise DocError("busy", "the conversion queue is full; retry later", retry_after_seconds=60) from None
        shutil.rmtree(self.docs_dir / doc_id, ignore_errors=True)
        self._jobs[doc_id] = job
        self._events[doc_id] = asyncio.Event()
        self._started[doc_id] = self.clock()
        self._write_status(doc_id, job, source_name=source.name, options=json.loads(options.cache_key()))

    async def _wait(self, doc_id: str, heartbeat) -> JobStatus:
        event = self._events[doc_id]
        deadline = asyncio.get_running_loop().time() + self.settings.max_wait
        while not event.is_set():
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                await asyncio.wait_for(event.wait(), min(self.heartbeat_seconds, remaining))
            except TimeoutError:
                await heartbeat(self.job(doc_id))
        return self.job(doc_id)

    async def _work(self) -> None:
        while True:
            doc_id, source, options = await self._queue.get()
            job = self._jobs[doc_id]
            job.status = "running"
            self._started[doc_id] = self.clock()
            self._write_status(doc_id, job)
            try:
                # shortcut: a timed-out conversion thread keeps running; it cannot be killed, only abandoned
                result = await asyncio.wait_for(asyncio.to_thread(self._run, doc_id, source, options), self.settings.job_timeout)
                job.status, job.result = "done", result
                self._write_status(doc_id, job, finished=datetime.now(timezone.utc).isoformat())
            except TimeoutError:
                self._fail(job, DocError("job_timeout", f"conversion exceeded {self.settings.job_timeout} s"))
            except DocError as error:
                self._fail(job, error)
            except Exception as error:
                self._fail(job, DocError("conversion_failed", f"{type(error).__name__}: {str(error)[:200]}"))
            gc.collect()
            self._events[doc_id].set()

    def _fail(self, job: JobStatus, error: DocError) -> None:
        job.status, job.code, job.message = "failed", error.code, error.message
        self._write_status(job.doc_id, job)

    def _run(self, doc_id: str, source: Path, options: ConvertOptions) -> dict:
        job = self._jobs[doc_id]

        def progress(stage: str, done: int, total: int) -> None:
            job.stage, job.pages_done, job.pages_total = stage, done, total
            self._write_status(doc_id, job)

        doc, warnings = self.converter.convert(source, options, progress)
        job.stage = "export"
        out = self.docs_dir / doc_id
        if source.suffix.lower() == ".pdf":
            shutil.copyfile(source, out / "source.pdf")
        summary = write_result(doc, out, source_name=source.name, options=options, warnings=warnings)
        return {"output_dir": str(out), "index": str(summary.index), "tree": summary.tree,
                "counts": summary.counts, "warnings": summary.warnings}


def _folder_bytes(folder: Path) -> int:
    return sum(p.stat().st_size for p in folder.rglob("*") if p.is_file())
