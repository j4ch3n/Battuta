"""Both tooling projects own their environments and generated-file ignores."""

import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize("project", ["bot_setup", "packaging"])
def test_uv_uses_own_environment_despite_root_environment(tmp_path, project):
    directory = ROOT / "scripts" / project
    result = subprocess.run(["uv", "run", "--project", str(directory), "--locked", "--no-sync", "python", "-c", "import sys; print(sys.prefix)"], cwd=tmp_path, env={**os.environ, "VIRTUAL_ENV": str(ROOT / ".venv")}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert Path(result.stdout.strip()) == directory / ".venv"


@pytest.mark.parametrize("project", ["bot_setup", "packaging"])
def test_local_ignore_rules_work_without_root_gitignore(tmp_path, project):
    shutil.copyfile(ROOT / "scripts" / project / ".gitignore", tmp_path / ".gitignore")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    generated = [".venv/private", "__pycache__/module.pyc", ".pytest_cache/state", "dist/file.whl", ".coverage"]
    sources = ["pyproject.toml", "uv.lock", "src/module.py", "tests/test_module.py"]
    result = subprocess.run(["git", "check-ignore", "--stdin"], cwd=tmp_path, input="\n".join(generated + sources), capture_output=True, text=True)
    assert result.returncode == 0
    assert set(result.stdout.splitlines()) == set(generated)
