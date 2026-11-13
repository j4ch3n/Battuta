"""Actual commit/release commands cannot bypass manifest validation."""

import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]


def test_commit_hook_uses_staged_selection_and_release_gate_uses_checkout(tmp_path):
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    (tmp_path / "package.json").write_text(json.dumps({"scripts": scripts}))
    entry = tmp_path / "skills-hub/research/SKILL.md"
    entry.parent.mkdir(parents=True)
    entry.write_text("research")
    manifest = tmp_path / "bots/worker/bot.toml"
    manifest.parent.mkdir(parents=True)
    manifest.write_text('[skills]\ninclude=["research"]')
    binary = tmp_path / "node_modules/.bin"
    binary.mkdir(parents=True)
    uv = binary / "uv"
    uv.write_text(f"#!{sys.executable}\n" + '''import os, sys
assert sys.argv[1:6] == ["run", "--project", "scripts/bot_setup", "--locked", "battuta-bot-setup"]
os.execv(sys.executable, [sys.executable, "-m", "bot_setup.cli", *sys.argv[6:]])
''')
    uv.chmod(0o700)
    following = binary / "lint-staged"
    following.write_text("#!/bin/sh\ntouch next-task\n")
    following.chmod(0o700)
    env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}"}
    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)
    def run(*command):
        return subprocess.run(command, cwd=tmp_path, env=env, capture_output=True, text=True)
    git("init", "-q")
    git("add", "bots", "skills-hub")
    result = run("bash", str(ROOT / ".husky/pre-commit"))
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "next-task").exists()
    (tmp_path / "next-task").unlink()
    manifest.write_text('[skills]\ninclude=["missing"]')
    git("add", "bots")
    manifest.write_text('[skills]\ninclude=["research"]')
    result = run("bash", str(ROOT / ".husky/pre-commit"))
    assert result.returncode != 0
    assert not (tmp_path / "next-task").exists()
    assert run("pnpm", "check:skills").returncode == 0
    manifest.write_text('[skills]\ninclude=["missing"]')
    assert run("pnpm", "check:skills").returncode != 0
