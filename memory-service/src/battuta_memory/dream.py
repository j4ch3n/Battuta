"""The nightly dream: distill archived days, consolidate, refresh overviews. Runs in its own process."""
import datetime as dt
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

from agent_memory.core import sessions
from agent_memory.core.distill import distill
from agent_memory.core.watermark import Watermark

from .manage import BattutaManage
from .overview import refresh_overviews
from .store import write_catalog

STATE_FILE = ".state/battuta-dream.json"
CATALOG_TIMEOUT = 30


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _alive(pid) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class DreamState:
    def __init__(self, root: Path):
        self.path = Path(root) / STATE_FILE

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {"status": "idle"}

    def _save(self, state: dict) -> dict:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        staged = self.path.with_suffix(".tmp")
        staged.write_text(json.dumps(state, ensure_ascii=False) + "\n", encoding="utf-8")
        staged.replace(self.path)
        return state

    def read(self) -> dict:
        state = self._load()
        if state.get("status") == "running" and not _alive(state.get("pid")):
            state = self._save({**state, "status": "failed", "error": "dream worker stopped unexpectedly", "finished_at": _now()})
        return {key: state.get(key) for key in ("status", "step", "started_at", "finished_at", "last_success_at", "error", "report")} | {"status": state.get("status", "idle")}

    def running(self) -> bool:
        return self.read()["status"] == "running"

    def start(self, pid: int) -> dict:
        previous = self._load()
        return self._save({"status": "running", "pid": pid, "step": "starting", "started_at": _now(),
                           "last_success_at": previous.get("last_success_at")})

    def step(self, name: str) -> None:
        self._save({**self._load(), "step": name})

    def finish(self, ok: bool, error: str | None = None, report: dict | None = None) -> None:
        state = {**self._load(), "status": "succeeded" if ok else "failed", "finished_at": _now(), "error": error, "report": report}
        if ok:
            state["last_success_at"] = state["started_at"]
        self._save(state)


def catalog_from_cli() -> list[str] | None:
    try:
        completed = subprocess.run(["battuta-project", "list", "--json"], capture_output=True, text=True, timeout=CATALOG_TIMEOUT, check=True)
        projects = json.loads(completed.stdout)["projects"]
        return [str(name) for name in projects]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        return None


def distill_backlog(store, ask) -> dict:
    watermark = Watermark(store.layout, store.clock)
    report = {}
    for key in watermark.sessions():
        mark = watermark.read(key)
        if mark.backlog() <= 0:
            continue
        messages = [message for message in sessions.read(store.layout, key) if message.index >= mark.distilled]
        if messages:
            report[key] = distill(store, key, messages, ask).as_dict()
    return report


def run_dream(store, state: DreamState, *, write_reasoner, manage_reasoner, ask, catalog=catalog_from_cli, today=None) -> dict:
    report = {}
    try:
        state.step("catalog")
        projects = catalog()
        if projects is not None:
            write_catalog(store.root, [name for name in projects if name != "global"])
        state.step("distill")
        report["distill"] = distill_backlog(store, write_reasoner)
        state.step("consolidate")
        dream = BattutaManage(store).sleep(reasoner=manage_reasoner)
        report["consolidate"] = {"actions": len(dream.actions), "decisions": [decision.detail for decision in dream.decisions],
                                 "open_proposals": len(dream.proposals), "report": dream.path}
        state.step("overview")
        report["overviews"] = refresh_overviews(store, ask, today or dt.date.today().isoformat())
    except Exception as error:
        report["failed_step"] = state._load().get("step")
        state.finish(False, f"{type(error).__name__}: {error}"[:500], report)
        raise
    state.finish(True, report=report)
    return report


def start_dream(config) -> dict:
    """Launch one detached worker; the HTTP server never runs the dream itself."""
    root = config.store_dir
    state = DreamState(root)
    if state.running():
        return {"status": "already_running", "state": state.read()}
    config.data_dir.mkdir(parents=True, exist_ok=True)
    with (config.data_dir / "dream.log").open("ab") as log:
        process = subprocess.Popen([sys.executable, "-m", "battuta_memory.cli", "dream", "run"], stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, start_new_session=True, env=os.environ.copy())
    state.start(process.pid)
    return {"status": "started", "state": state.read()}


def worker_main(config) -> int:
    from .embedder import load_embedder
    from .layout import initialize_store
    from .reasoner import claude_reasoner
    from .store import BattutaStore
    initialize_store(config.store_dir)
    state = DreamState(config.store_dir)
    if state._load().get("pid") != os.getpid():
        state.start(os.getpid())
    try:
        store = BattutaStore(config.store_dir, embedder=load_embedder(Path.home()), distill_view=True, agent="battuta-dream")
        store.init()
        reasoner = claude_reasoner(config.dream_model)
        report = run_dream(store, state, write_reasoner=reasoner, manage_reasoner=reasoner, ask=reasoner)
    except Exception as error:
        if state._load().get("status") == "running":
            state.finish(False, f"{type(error).__name__}: {error}"[:500])
        traceback.print_exc()
        return 1
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 0
