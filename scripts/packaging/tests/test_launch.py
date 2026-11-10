"""Launch a harmless Node entry point, never a real bot or model."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from battuta_packaging.bundle import ENTRY_OUTPUTS


@pytest.fixture
def installed(tmp_path):
    root, home = tmp_path / "install", tmp_path / "home"
    node = Path(shutil.which("node")).resolve()
    for entry in ENTRY_OUTPUTS:
        path = root / entry
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("export default function () {}")
    for profile in ("cos-bot", "manager-bot", "worker"):
        bot = root / "bots" / profile
        (bot / ".pi/skills").mkdir(parents=True, exist_ok=True)
        (bot / "AGENTS.md").write_text("instructions")
        (bot / ".pi/settings.json").write_text("{}")
        cli = bot / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
        cli.parent.mkdir(parents=True)
        cli.write_text('console.log(JSON.stringify({cwd:process.cwd(),env:process.env,args:process.argv.slice(2)}))')
    version = subprocess.check_output([str(node), "--version"], text=True).strip().removeprefix("v")
    (root / "bots/release.json").write_text(json.dumps({"node": version, "skills": {p: [] for p in ("cos-bot", "manager-bot", "worker")}}))
    env = tmp_path / ".env.prod"
    env.write_text("WORKER_BOT_COUNT=2\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=private-key\nLINEAR_API_TOKEN=private-linear\nCOS_TELEGRAM_TOKEN=private-telegram\n")
    for name in ("manager-bot", "worker-1", "worker-2"):
        pi = home / ".battuta/pi-bots" / name / ".pi"
        pi.mkdir(parents=True)
        (pi / "mcp.json").write_text("{}")
    return root, home, env, node


@pytest.mark.parametrize("bot", ["manager-bot", "worker-1", "worker-2"])
def test_launch_cwd_private_state_and_credentials(installed, bot):
    root, home, env_file, node = installed
    result = subprocess.run([sys.executable, "-m", "battuta_packaging.cli", "run-bot", "--root", str(root), "--bot", bot, "--env-file", str(env_file), "--node", str(node), "--mode", "service"], env={**os.environ, "HOME": str(home)}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output["cwd"] == str(root / "bots" / ("worker" if bot.startswith("worker-") else bot))
    assert output["env"]["PI_CODING_AGENT_DIR"] == str(home / ".battuta/pi-bots" / bot / ".pi")
    assert not any("TELEGRAM" in key for key in output["env"])
    assert output["env"]["LINEAR_API_TOKEN"] == "private-linear"
    assert "--session-dir" in output["args"]


def test_maintenance_refuses_active_service(installed, monkeypatch):
    from battuta_packaging import launch
    from types import SimpleNamespace
    root, home, env_file, node = installed
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr(launch.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout="active\n"))
    with pytest.raises(Exception, match="inactive"):
        launch.run_bot(root, bot="worker-2", env_file=env_file, node=node, mode="foreground-maintenance")
