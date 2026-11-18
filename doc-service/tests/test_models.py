import json
import os
import stat

import pytest

from battuta_doc.models import ModelManager


class Recorder:
    def __init__(self, fail_once=False):
        self.calls = []
        self.fail_once = fail_once

    def __call__(self, models_dir, group):
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("network down")
        self.calls.append(group)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    monkeypatch.delenv("HF_HUB_DISABLE_TELEMETRY", raising=False)


def test_ensure_downloads_each_group_once_and_is_idempotent(tmp_path):
    rec = Recorder()
    m = ModelManager(tmp_path, rec)
    m.ensure()
    m.ensure()
    assert rec.calls == ["baseline", "charts"]


def test_state_transitions_ready_after_ensure(tmp_path):
    m = ModelManager(tmp_path, Recorder())
    assert m.health() == {"ready": False, "state": "warming_up", "error": None}
    m.ensure()
    assert m.health() == {"ready": True, "state": "ready", "error": None}


def test_downloader_failure_sets_failed_with_error_and_next_ensure_retries(tmp_path):
    rec = Recorder(fail_once=True)
    m = ModelManager(tmp_path, rec)
    m.ensure()
    h = m.health()
    assert h["state"] == "failed" and not h["ready"] and "network down" in h["error"]
    m.ensure()
    assert m.health()["state"] == "ready" and rec.calls == ["baseline", "charts"]


def test_describe_group_is_lazy(tmp_path):
    rec = Recorder()
    m = ModelManager(tmp_path, rec)
    m.ensure()
    assert "describe" not in rec.calls
    m.ensure_group("describe")
    m.ensure_group("describe")
    assert rec.calls.count("describe") == 1


def test_ensure_sets_offline_env_after_ready(tmp_path):
    m = ModelManager(tmp_path, Recorder())
    m.ensure()
    assert os.environ["HF_HUB_OFFLINE"] == "1" and os.environ["HF_HUB_DISABLE_TELEMETRY"] == "1"


def test_failed_ensure_keeps_network_available(tmp_path):
    m = ModelManager(tmp_path, Recorder(fail_once=True))
    m.ensure()
    assert "HF_HUB_OFFLINE" not in os.environ


def test_state_file_written_with_groups_and_not_world_readable(tmp_path):
    m = ModelManager(tmp_path, Recorder())
    m.ensure()
    path = tmp_path / "state.json"
    assert json.loads(path.read_text())["groups"] == ["baseline", "charts"]
    assert stat.S_IMODE(path.stat().st_mode) & 0o077 == 0
    assert new_manager_sees_groups(tmp_path)


def new_manager_sees_groups(tmp_path):
    rec = Recorder()
    ModelManager(tmp_path, rec).ensure()
    return rec.calls == []
