"""Support checks run every Python project through pytest in its own environment."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[4]
PROJECTS = ("scripts/bot_setup", "scripts/packaging", "memory-service", "speech-service", "artifact-service", "project-context-cli")


@pytest.fixture
def run_checks(tmp_path):
    """Run the real runner against a disposable tree whose `uv` only logs its arguments."""
    for name in ("scripts/checks/check-support.mjs", "scripts/packaging/release-build.sh", "scripts/packaging/release-wheels.sh", "scripts/bot_setup/run-dev.sh",
                 "scripts/setup-memory.sh", "scripts/setup-artifacts.sh", "scripts/bot_setup/run-worker.sh",
                 "scripts/supabase/sync-lifecycle-settings.test.mjs"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if name == "scripts/checks/check-support.mjs":
            shutil.copyfile(ROOT / name, path)
        else:
            path.touch()
    for project in PROJECTS:
        folder = tmp_path / project / "tests"
        folder.mkdir(parents=True)
        (folder / "test_unit.py").touch()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    uv = bin_dir / "uv"
    uv.write_text(f"#!{sys.executable}\n" +
                  "import json, os, sys\n"
                  "with open(os.environ['UV_LOG'], 'a') as log:\n"
                  "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                  "sys.exit(9 if os.environ.get('UV_FAIL') else 0)\n")
    uv.chmod(0o700)
    log = tmp_path / "uv.log"
    base = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "UV_LOG": str(log)}

    def run(**env):
        result = subprocess.run(["node", "scripts/checks/check-support.mjs"], cwd=tmp_path,
                                env={**base, **env}, capture_output=True, text=True, timeout=15)
        return result, [json.loads(line) for line in log.read_text().splitlines()]

    return tmp_path, run


def test_runs_pytest_once_per_package_in_its_environment(run_checks):
    root, run = run_checks
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert len(calls) == len(PROJECTS)
    for project, call in zip(PROJECTS, calls, strict=True):
        prefix = ["run", "--project", str(root / project), "--locked"]
        assert call[:len(prefix)] == prefix, call
        assert call[-4:] == ["-m", "pytest", str(root / project / "tests"), "-q"], call


def test_pytest_failure_stops_checks_and_preserves_exit_status(run_checks):
    _, run = run_checks
    result, calls = run(UV_FAIL="1")
    assert result.returncode == 9, result.stdout + result.stderr
    assert len(calls) == 1
