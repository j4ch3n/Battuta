"""Dependency setup is explicit, pinned and confined to installed profiles."""

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import click
import pytest

from battuta_packaging import runtime


def test_install_is_frozen_and_install_local(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "validate_bundle", lambda root: {"node": "24.21.0", "packageManager": "pnpm@10.20.0", "packages": {"cos-bot": ["npm:example@1.2.3"], "manager-bot": [], "worker": []}})
    calls = []
    def command(args, **kwargs):
        calls.append((args, kwargs))
        if args[-1] == "--version":
            return SimpleNamespace(stdout="v24.21.0\n" if str(args[0]).endswith("node") else "10.20.0\n")
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(runtime.subprocess, "run", command)
    monkeypatch.setattr(runtime.shutil, "which", lambda name, **kwargs: "/tools/" + name)
    for profile in ("cos-bot", "manager-bot", "worker"):
        pi = tmp_path / "bots" / profile / ".pi"
        pi.mkdir(parents=True)
        (pi / "settings.json").write_text("{}")
    runtime.install_runtime(tmp_path, node=Path("/tools/node"))
    installs = [(args, options) for args, options in calls if "install" in args]
    assert any("--frozen-lockfile" in args and "--prod" in args for args, _ in installs)
    pi_args, options = next((args, opts) for args, opts in installs if "npm:example@1.2.3" in args)
    assert "-l" in pi_args
    assert options["env"]["PI_CODING_AGENT_DIR"] == str(tmp_path / "bots/cos-bot/.pi")
    assert json.loads((tmp_path / "bots/runtime.json").read_text())["node"] == "/tools/node"


def test_wrong_node_stops_before_install(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "validate_bundle", lambda root: {"node": "24.21.0"})
    monkeypatch.setattr(runtime.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="v22.0.0\n"))
    with pytest.raises(click.ClickException, match="Node"):
        runtime.install_runtime(tmp_path, node=Path("/tools/node"))
    assert not (tmp_path / "bots/runtime.json").exists()


@pytest.mark.parametrize("component,command", [("memory", "battuta-memory"), ("artifacts", "battuta-artifact")])
def test_component_environment_is_loaded_and_scrubbed(tmp_path, component, command):
    tool = tmp_path / command
    tool.write_text(f"#!{sys.executable}\nimport json,os,sys\nprint(json.dumps({{'args':sys.argv[1:],'data':os.environ.get('BATTUTA_MEMORY_DATA_DIR'),'telegram':any('TELEGRAM' in key for key in os.environ)}}))\n")
    tool.chmod(0o700)
    env_file = tmp_path / ".env.prod"
    env_file.write_text('BATTUTA_MEMORY_DATA_DIR="/private/memory"\nCOS_TELEGRAM_TOKEN=sentinel\n')
    result = subprocess.run([sys.executable, "-m", "battuta_packaging.cli", "run-component", "--component", component, "--env-file", str(env_file)], env={**os.environ, "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"]}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"args": ["serve"], "data": "/private/memory", "telegram": False}
