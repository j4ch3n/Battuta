"""Exercise artifact provisioning without installing into the real host."""

import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.integration

ROOT = Path(__file__).parents[4]


def install_script(root):
    (root / "scripts").mkdir()
    shutil.copy2(ROOT / "scripts/setup-artifacts.sh", root / "scripts/setup-artifacts.sh")
    binary = root / "bin"
    binary.mkdir()
    return binary


def test_source_setup_installs_locked_dependencies_then_runs_migrations(tmp_path):
    binary = install_script(tmp_path)
    venv = tmp_path / "artifact-service/.venv/bin"
    venv.mkdir(parents=True)
    (tmp_path / "artifact-service/pyproject.toml").touch()
    for path in [binary / "uv", venv / "battuta-artifact"]:
        path.write_text('#!/usr/bin/env python3\nimport json, os, sys\nwith open(os.environ["CALLS"], "a") as f: f.write(json.dumps(sys.argv) + "\\n")\n')
        path.chmod(0o755)
    log = tmp_path / "calls"
    result = subprocess.run(["bash", str(tmp_path / "scripts/setup-artifacts.sh")],
                            env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "CALLS": str(log)},
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert calls[0][1:3] == ["sync", "--project"]
    assert "--locked" in calls[0]
    assert "--no-dev" in calls[0]
    assert calls[-1][1:] == ["setup"]


def test_release_setup_only_runs_installed_migrations_and_propagates_failure(tmp_path):
    binary = install_script(tmp_path)
    cli = binary / "battuta-artifact"
    cli.write_text('#!/bin/sh\ntest "$*" = setup || exit 99\nexit 7\n')
    cli.chmod(0o700)
    result = subprocess.run(["bash", str(tmp_path / "scripts/setup-artifacts.sh")],
                            env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}"},
                            capture_output=True, text=True)
    assert result.returncode == 7, result.stdout + result.stderr
    assert not (tmp_path / "artifact-service").exists()


def test_setup_rejects_unknown_arguments():
    result = subprocess.run(["bash", str(ROOT / "scripts/setup-artifacts.sh"), "--unknown"], capture_output=True, text=True)
    assert result.returncode == 2
