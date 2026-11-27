"""Launcher prepares private configuration and execs the ordinary CLI (stubbed)."""

import json
import os
import re
import shutil
import subprocess
from urllib.parse import unquote

import pytest

from bot_setup.browser import configure_browser
from bot_setup.extensions import prepare_source_extensions, profile_settings
from bot_setup.manifest import load_profile
from bot_setup.mcp import configure_mcp
from fixtures import ROOT
from skill_fixtures import manifest_text, write_delegate_templates

pytestmark = pytest.mark.integration

CLI_PATH = "assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"


@pytest.fixture
def home(tmp_path, monkeypatch):
    path = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(path))
    return path


@pytest.fixture
def checkout(tmp_path):
    """A source checkout holding only run-worker.sh, a stub Pi CLI and a stub `bin` directory."""
    root = (tmp_path / "root").resolve()
    scripts = root / "scripts/bot_setup"
    scripts.mkdir(parents=True)
    shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
    cli = root / CLI_PATH
    cli.parent.mkdir(parents=True)
    cli.write_text("fixture")
    (root / "bin").mkdir()
    return root


def stub_command(root, name, body):
    path = root / "bin" / name
    path.write_text(body)
    path.chmod(0o755)


def launch(root, env, *extra):
    return subprocess.run(["bash", str(root / "scripts/bot_setup/run-worker.sh"), *extra], env=env, text=True, capture_output=True)


def with_stubs(root, **extra):
    return {**os.environ, "PATH": f"{root / 'bin'}:{os.environ['PATH']}", **extra}


def test_launch_exports_worker_context_without_telegram_or_scheduler(checkout, home):
    root = checkout
    bot = home / ".battuta/pi-bots/worker-1"
    (bot / ".pi").mkdir(parents=True)
    (bot / ".pi/settings.json").write_text("{}")
    (bot / ".pi/mcp.json").write_text("{}")
    (root / "bots/worker").mkdir(parents=True)
    (root / "bots/worker/bot.toml").write_text(manifest_text("worker", []))
    write_delegate_templates(root / "bots/worker")
    (root / "bots/worker/abilities.json").write_text('{"research": {}}')
    configure_browser(root / "bots/worker", bot, home=home, bot="worker-1")
    stub_command(root, "node", "#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({'args':sys.argv[1:],'role':os.environ.get('AGENT_ROLE'),'capabilities':json.loads(os.environ['BATTUTA_WORKER_CAPABILITIES']),'agentDir':os.environ.get('PI_CODING_AGENT_DIR'),'private':[key for key in os.environ if 'TELEGRAM' in key or key.startswith('PI_SCHEDULER')]}))\n")
    stub_command(root, "chromium-browser", "#!/bin/sh\nexit 99\n")
    env_file = root / ".env"
    env_file.write_text('BATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_CAPABILITIES=["must-not-override"]\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n')
    env = with_stubs(root, COS_TELEGRAM_TOKEN="private-sentinel", PI_SCHEDULER_STATE_FILE="private-sentinel")
    args = ("--bot-dir", str(bot), "--env-file", str(env_file))
    result = launch(root, env, *args)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output["role"] == "worker"
    assert output["capabilities"] == ["research"]
    assert output["agentDir"] == str(bot / ".pi")
    assert output["private"] == []
    assert "--print" not in output["args"]
    assert output["args"][0] == str(root / CLI_PATH)
    assert output["args"][1] == "--model"
    assert re.fullmatch(r"[^/\s]+/\S+", output["args"][2])
    assert len(output["args"]) == 3
    env_file.write_text("SUPABASE_URL=http://127.0.0.1:54321\n")
    failed = launch(root, env, *args)
    assert failed.returncode != 0
    assert "private-sentinel" not in failed.stdout + failed.stderr


def test_first_launch_copies_generated_mcp_and_rebases_shared_settings(checkout, home):
    root = checkout
    profile = root / "bots/worker"
    (profile / ".pi").mkdir(parents=True)
    (profile / "bot.toml").write_text(manifest_text("worker", []).replace(
        'pi_coding_agent_dir = "{instance}/.pi"',
        'pi_coding_agent_dir = "{instance}/runtime/.pi"',
    ))
    (profile / "abilities.json").write_text('{"research": {}}')
    (profile / "AGENTS.md").write_text("profile instructions")
    manifest = load_profile(profile / "bot.toml", "worker")
    (profile / ".pi/settings.json").write_text(json.dumps(profile_settings(manifest, browser=True)))
    source = root / "assignment-worker/index.ts"
    source.write_text("export default () => {}")
    (root / "agent-mail").mkdir()
    (root / "agent-mail/index.ts").write_text("export default () => {}")
    prepare_source_extensions(root, profile, manifest.extensions)
    configure_mcp(profile, role="worker", supabase_url="http://127.0.0.1:54321")
    (profile / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture mobile browser"}}')
    write_delegate_templates(profile)
    (profile / ".pi/auth.json").write_text("never-copy")
    stub_command(root, "node", '#!/bin/sh\nprintf "%s\\n" "$PI_CODING_AGENT_DIR" "$PWD" "$AGENT_ID" "$BATTUTA_PROJECTS_ROOT_HEADER"\n')
    stub_command(root, "chromium-browser", "#!/bin/sh\nexit 99\n")
    (root / ".env").write_text("BATTUTA_WORKER_1_TYPE=general\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
    bot = home / ".battuta/pi-bots/worker-1/runtime"
    env = with_stubs(root)
    first = launch(root, env, "--bot-dir", str(bot))
    assert first.returncode == 0, first.stderr
    lines = first.stdout.splitlines()
    assert lines[:3] == [str(bot / ".pi"), str(profile), "worker-1"]
    assert unquote(lines[3]) == str(home / ".battuta/projects")
    settings = json.loads((bot / ".pi/settings.json").read_text())
    assert settings["defaultThinkingLevel"] == manifest.defaults.thinking
    assert "extensions" not in settings
    assert [entry["source"] if isinstance(entry, dict) else entry for entry in settings["packages"]] == manifest.packages.pi
    assert (profile / ".pi/extensions/assignment-worker.ts").resolve() == source
    assert not (bot / "AGENTS.md").exists()
    assert (bot / ".pi/mcp.json").read_bytes() == (profile / ".pi/mcp.json").read_bytes()
    assert (bot / ".pi/web-search.json").read_bytes() == (profile / ".pi/web-search.json").read_bytes()
    assert "private-sentinel" not in (bot / ".pi/mcp.json").read_text()
    assert not (bot / ".pi/auth.json").exists()
    settings["theme"] = "custom"
    private_settings = json.dumps(settings)
    (bot / ".pi/settings.json").write_text(private_settings)
    (bot / ".pi/mcp.json").unlink()
    (bot / ".pi/web-search.json").unlink()
    missing_mcp = launch(root, env, "--bot-dir", str(bot))
    assert missing_mcp.returncode == 0, missing_mcp.stderr
    assert (bot / ".pi/mcp.json").read_bytes() == (profile / ".pi/mcp.json").read_bytes()
    assert (bot / ".pi/web-search.json").read_bytes() == (profile / ".pi/web-search.json").read_bytes()
    assert (bot / ".pi/settings.json").read_text() == private_settings
    for name in ("auth.json", "web-search.json"):
        (bot / ".pi" / name).write_text("private-state")
    (bot / ".pi/mcp.json").write_text('{"mcpServers": {"custom": {}}}')
    again = launch(root, env, "--bot-dir", str(bot))
    assert again.returncode == 0, again.stderr
    assert (bot / ".pi/settings.json").read_text() == private_settings
    for name in ("auth.json", "web-search.json"):
        assert (bot / ".pi" / name).read_text() == "private-state"
    assert json.loads((bot / ".pi/mcp.json").read_text()) == {"mcpServers": {"custom": {}}}


def test_missing_shared_mcp_stops_before_launch_with_configuration_command(checkout, home):
    root = checkout
    (root / "bots/worker").mkdir(parents=True)
    (root / "bots/worker/bot.toml").write_text(manifest_text("worker", []))
    write_delegate_templates(root / "bots/worker")
    (root / "bots/worker/abilities.json").write_text('{"research": {}}')
    bot = home / ".battuta/pi-bots/worker-1"
    (bot / ".pi").mkdir(parents=True)
    (bot / ".pi/settings.json").write_text("{}")
    (root / ".env").write_text("BATTUTA_WORKER_1_TYPE=general\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
    stub_command(root, "node", "#!/bin/sh\nprintf 'unexpected-launch\\n'\n")
    result = launch(root, with_stubs(root), "--bot-dir", str(bot))
    assert result.returncode != 0
    assert result.stdout == ""
    assert "--role worker" in result.stderr
    assert "private-sentinel" not in result.stderr
    assert not (bot / ".pi/mcp.json").exists()
