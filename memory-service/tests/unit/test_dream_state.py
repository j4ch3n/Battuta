import os
import subprocess
import sys
from unittest import mock

import pytest

from battuta_memory import dream
from battuta_memory.config import MemoryConfig
from battuta_memory.dream import DreamState


@pytest.fixture
def config(tmp_path):
    return MemoryConfig(data_dir=tmp_path)


@pytest.fixture
def state(config):
    return DreamState(config.store_dir)


def test_second_start_reports_already_running(config, state):
    state.start(os.getpid())
    with mock.patch.object(dream.subprocess, "Popen") as popen:
        assert dream.start_dream(config)["status"] == "already_running"
    popen.assert_not_called()


def test_dead_pid_is_reported_failed_and_can_restart(config, state):
    finished = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True, check=True)
    state.start(int(finished.stdout))
    current = state.read()
    assert (current["status"], current["error"]) == ("failed", "dream worker stopped unexpectedly")
    with mock.patch.object(dream.subprocess, "Popen", return_value=mock.Mock(pid=os.getpid())) as popen:
        assert dream.start_dream(config)["status"] == "started"
    assert popen.call_args.args[0][1:] == ["-m", "battuta_memory.cli", "dream", "run"]


def test_status_keeps_last_success_across_failure(state):
    state.start(os.getpid())
    state.finish(True, report={})
    success = state.read()["last_success_at"]
    state.start(os.getpid())
    state.finish(False, "boom")
    assert state.read()["last_success_at"] == success
    assert state.read()["status"] == "failed"


def test_idle_before_first_dream(state):
    assert state.read()["status"] == "idle"
    assert state.read()["last_success_at"] is None
