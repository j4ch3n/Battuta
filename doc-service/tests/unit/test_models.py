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


def test_ensure_downloads_each_group_once_then_goes_offline(tmp_path):
    rec = Recorder()
    m = ModelManager(tmp_path, rec)
    assert m.health() == {"ready": False, "state": "warming_up", "error": None}
    m.ensure()
    m.ensure()
    assert rec.calls == ["baseline", "charts"]
    assert m.health() == {"ready": True, "state": "ready", "error": None}
    assert os.environ["HF_HUB_OFFLINE"] == "1" and os.environ["HF_HUB_DISABLE_TELEMETRY"] == "1"


def test_download_failure_reports_error_keeps_network_and_retries(tmp_path):
    rec = Recorder(fail_once=True)
    m = ModelManager(tmp_path, rec)
    m.ensure()
    h = m.health()
    assert h["state"] == "failed" and not h["ready"] and "network down" in h["error"]
    assert "HF_HUB_OFFLINE" not in os.environ
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


def test_state_file_is_private_and_lets_a_new_manager_skip_downloads(tmp_path):
    ModelManager(tmp_path, Recorder()).ensure()
    path = tmp_path / "state.json"
    assert json.loads(path.read_text())["groups"] == ["baseline", "charts"]
    assert stat.S_IMODE(path.stat().st_mode) & 0o077 == 0
    again = Recorder()
    ModelManager(tmp_path, again).ensure()
    assert again.calls == []
