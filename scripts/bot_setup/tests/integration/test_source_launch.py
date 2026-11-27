"""The shell entry point refuses an unselected worker before provisioning anything."""

from pathlib import Path
import shutil
import subprocess

import pytest

from skill_fixtures import unselected_worker_checkout

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[4]


@pytest.mark.parametrize("selection,worker", [
    pytest.param("", "worker-1", id="no-selection"),
    pytest.param("BATTUTA_WORKER_0_TYPE=general", "worker-1", id="index-zero"),
    pytest.param("BATTUTA_WORKER_1_TYPE=", "worker-1", id="empty-type"),
    pytest.param("BATTUTA_WORKER_1_TYPE=general", "worker-2", id="other-worker-selected"),
])
def test_unselected_worker_stops_before_provisioning(tmp_path, selection, worker):
    root, _ = unselected_worker_checkout(tmp_path, selection)
    scripts = root / "scripts/bot_setup"
    scripts.mkdir(parents=True)
    shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
    bot = tmp_path / "private" / worker
    result = subprocess.run(["bash", str(scripts / "run-worker.sh"), "--bot-dir", str(bot)], capture_output=True, text=True)
    assert result.returncode != 0
    assert "BATTUTA_WORKER" in result.stderr
    assert not bot.exists()
