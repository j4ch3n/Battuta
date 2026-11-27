import asyncio
from dataclasses import replace
import os
from pathlib import Path
import threading
import time
from types import SimpleNamespace

import pytest
from docling_core.types.doc import DoclingDocument

from battuta_doc import jobs
from battuta_doc.config import DocError, Settings
from battuta_doc.jobs import JobManager
from battuta_doc.options import ConvertOptions

OPTS = ConvertOptions.from_args()


class FakeConverter:
    def __init__(self, gate: threading.Event | None = None, error: Exception | None = None):
        self.calls = 0
        self.gate = gate
        self.error = error

    def convert(self, source, options, on_progress):
        self.calls += 1
        on_progress("layout", 1, 2)
        if self.gate:
            self.gate.wait(5)
        if self.error:
            raise self.error
        return DoclingDocument(name="d"), []


def setup(tmp_path, converter=None, state="ready", **overrides):
    env = {"BATTUTA_DOC_DATA_DIR": str(tmp_path / "data"), "BATTUTA_DOC_INPUT_ROOTS": str(tmp_path)}
    settings = replace(Settings.from_env(env), **overrides)
    conv = converter or FakeConverter()
    manager = JobManager(settings, conv, SimpleNamespace(state=state), heartbeat_seconds=0.02)
    return manager, conv


def src(tmp_path, name="a.pdf", data=b"%PDF"):
    p = tmp_path / name
    p.write_bytes(data)
    return p


async def noop(status):
    pass


async def settled(m, *, running, queued):
    """Wait until hashing threads and the worker have reached the expected queue state."""
    async with asyncio.timeout(5):
        while (len(m.queue_state()["running"]), len(m.queue_state()["queued"])) != (running, queued):
            await asyncio.sleep(0.01)


def test_cache_hit_returns_done_without_converting(tmp_path):
    m, conv = setup(tmp_path)

    async def go():
        first = await m.convert(src(tmp_path), OPTS, noop)
        second = await m.convert(src(tmp_path), OPTS, noop)
        return first, second

    first, second = asyncio.run(go())
    assert first.status == second.status == "done" and conv.calls == 1
    assert second.result["index"].endswith("INDEX.md") and (Path(first.result["output_dir"]) / "source.pdf").exists()


def test_concurrent_identical_calls_share_one_conversion(tmp_path):
    gate = threading.Event()
    m, conv = setup(tmp_path, FakeConverter(gate))

    async def go():
        a = asyncio.create_task(m.convert(src(tmp_path), OPTS, noop))
        b = asyncio.create_task(m.convert(src(tmp_path), OPTS, noop))
        await asyncio.sleep(0.1)
        gate.set()
        return await asyncio.gather(a, b)

    a, b = asyncio.run(go())
    assert conv.calls == 1 and a.doc_id == b.doc_id and a.status == b.status == "done"


def test_calls_serialize_and_full_queue_returns_busy(tmp_path):
    gate = threading.Event()
    m, conv = setup(tmp_path, FakeConverter(gate), max_queue=1)

    async def go():
        tasks = [asyncio.create_task(m.convert(src(tmp_path, "0.pdf", b"0"), OPTS, noop))]
        await settled(m, running=1, queued=0)
        tasks.append(asyncio.create_task(m.convert(src(tmp_path, "1.pdf", b"1"), OPTS, noop)))
        await settled(m, running=1, queued=1)
        with pytest.raises(DocError) as e:
            await m.convert(src(tmp_path, "3.pdf", b"3"), OPTS, noop)
        assert e.value.code == "busy"
        gate.set()
        return await asyncio.gather(*tasks)

    results = asyncio.run(go())
    assert [r.status for r in results] == ["done", "done"] and conv.calls == 2


def test_warming_models_return_warming_up_with_retry_after(tmp_path):
    m, _ = setup(tmp_path, state="warming_up")
    with pytest.raises(DocError) as e:
        asyncio.run(m.convert(src(tmp_path), OPTS, noop))
    assert e.value.code == "warming_up" and e.value.data["retry_after_seconds"] > 0


def test_blocking_wait_cap_returns_running_status_and_heartbeat_called(tmp_path):
    gate = threading.Event()
    m, _ = setup(tmp_path, FakeConverter(gate), max_wait=0.2)
    beats = []

    async def hb(status):
        beats.append(status.stage)

    async def go():
        status = await m.convert(src(tmp_path), OPTS, hb)
        gate.set()
        return status

    status = asyncio.run(go())
    assert status.status == "running" and status.pages_total == 2 and beats


def test_job_timeout_marks_failed_and_frees_worker(tmp_path):
    gate = threading.Event()
    m, conv = setup(tmp_path, FakeConverter(gate), job_timeout=0.1)

    async def go():
        first = await m.convert(src(tmp_path), OPTS, noop)
        gate.set()
        conv.gate = None
        second = await m.convert(src(tmp_path, "b.pdf", b"b"), OPTS, noop)
        return first, second

    first, second = asyncio.run(go())
    assert (first.status, first.code) == ("failed", "job_timeout") and second.status == "done"


def test_converter_error_marks_failed_with_code(tmp_path):
    m, _ = setup(tmp_path, FakeConverter(error=DocError("encrypted", "locked")))
    status = asyncio.run(m.convert(src(tmp_path), OPTS, noop))
    assert (status.status, status.code) == ("failed", "encrypted") and m.job(status.doc_id).code == "encrypted"


def test_recover_marks_leftover_running_as_failed_service_restarted_and_rerun_succeeds(tmp_path):
    m, conv = setup(tmp_path)
    doc_id = asyncio.run(m.convert(src(tmp_path), OPTS, noop)).doc_id
    m._write_status(doc_id, jobs.JobStatus(doc_id, "running"))
    (m.docs_dir / doc_id / "INDEX.md").unlink()
    m2, conv2 = setup(tmp_path)
    m2.recover()
    status = m2.job(doc_id)
    assert (status.status, status.code) == ("failed", "service_restarted")
    again = asyncio.run(m2.convert(src(tmp_path), OPTS, noop))
    assert again.status == "done" and conv2.calls == 1


def test_delete_refuses_running_job_and_rejects_bad_ids(tmp_path):
    gate = threading.Event()
    m, _ = setup(tmp_path, FakeConverter(gate), max_wait=0.1)

    async def go():
        status = await m.convert(src(tmp_path), OPTS, noop)
        with pytest.raises(DocError) as e:
            m.delete(status.doc_id)
        assert e.value.code == "job_running"
        gate.set()
        await asyncio.sleep(0.1)
        m.delete(status.doc_id)
        assert not (m.docs_dir / status.doc_id).exists()

    asyncio.run(go())
    for bad in ("../x", "zz"):
        with pytest.raises(DocError):
            m.delete(bad)


def test_sweep_removes_only_expired_folders(tmp_path):
    m, _ = setup(tmp_path, retention_days=1)

    async def go():
        a = await m.convert(src(tmp_path, "a.pdf", b"a"), OPTS, noop)
        b = await m.convert(src(tmp_path, "b.pdf", b"b"), OPTS, noop)
        return a.doc_id, b.doc_id

    old, new = asyncio.run(go())
    stamp = time.time() - 3 * 86400
    os.utime(m.docs_dir / old / "status.json", (stamp, stamp))
    assert m.sweep() == 1
    assert not (m.docs_dir / old).exists() and (m.docs_dir / new).exists()
    assert [r["doc_id"] for r in m.list()] == [new]
