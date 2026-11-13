"""Worker selection must apply before source launch or private provisioning."""

import os
from pathlib import Path
import shutil
import subprocess

import click
import pytest

from bot_setup.source_launch import run_source_worker
from skill_fixtures import manifest_text


@pytest.mark.parametrize("count,worker", [(None, "worker-1"), ("invalid", "worker-1"), ("0", "worker-1"), ("1", "worker-2")])
@pytest.mark.parametrize("entry", ["python", "shell"])
def test_unselected_worker_stops_before_provisioning(tmp_path, monkeypatch, count, worker, entry):
    root = tmp_path / "source"
    scripts = root / "scripts/bot_setup"
    scripts.mkdir(parents=True)
    shutil.copy2(Path(__file__).resolve().parents[3] / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
    cli = root / "bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
    cli.parent.mkdir(parents=True)
    cli.touch()
    (root / "bots/worker/bot.toml").write_text(manifest_text("worker", []))
    env_file = root / ".env"
    env_file.write_text("SUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=fixture\n" + (f"WORKER_BOT_COUNT={count}\n" if count is not None else ""))
    bot = tmp_path / "private" / worker
    if entry == "python":
        monkeypatch.setattr(os, "execve", lambda *args: pytest.fail("Unselected worker executed"))
        with pytest.raises(click.ClickException, match="WORKER_BOT_COUNT"):
            run_source_worker(root, bot_dir=bot, env_file=env_file, node=Path(shutil.which("node")))
    else:
        result = subprocess.run(["bash", str(scripts / "run-worker.sh"), "--bot-dir", str(bot)], capture_output=True, text=True)
        assert result.returncode != 0
        assert "WORKER_BOT_COUNT" in result.stderr
    assert not bot.exists()
