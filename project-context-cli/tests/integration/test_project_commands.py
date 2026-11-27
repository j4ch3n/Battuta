"""Real installed CLI project operations preserve unrelated work material."""

import os
from pathlib import Path
import subprocess
import sys

import pytest
import yaml

pytestmark = pytest.mark.integration

NAMES = ("atlas", "harbor")
BINARY = str(Path(sys.executable).with_name("battuta-project"))
OPERATIONS = {
    "explain": lambda name: ["explain", name],
    "github": lambda name: ["github", "link", name, f"https://github.com/team/{name}"],
    "linear": lambda name: ["linear", "link", name, f"{name}-project,{name}-team"],
}


@pytest.fixture
def env(tmp_path):
    return {**os.environ, "HOME": str(tmp_path), "LINEAR_API_TOKEN": "test-token"}


@pytest.fixture
def cli(tmp_path, env):
    def run(*args):
        result = subprocess.run([BINARY, *args], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        return result.stdout
    return run


@pytest.fixture
def sentinels(tmp_path, cli):
    """Unrelated private files written into each initialized project."""
    for name in NAMES:
        cli("init", name)
    files = {}
    for name in NAMES:
        for relative in ("work/a3f91c2e/note.md", "specs/api/spec-v1.md", "specs/.config.json"):
            path = tmp_path / ".battuta/projects" / name / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"Private {name} {relative}\n".encode())
            files[path] = path.read_bytes()
    return files


@pytest.mark.parametrize("operation", OPERATIONS)
def test_concurrent_explicit_project_operations_preserve_each_projects_files(tmp_path, env, cli, sentinels, operation):
    root = tmp_path / ".battuta/projects"
    assert "atlas" in cli("list")
    processes = [(name, subprocess.Popen(
        [BINARY, *OPERATIONS[operation](name)],
        cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )) for name in NAMES]
    for name, process in processes:
        output, error = process.communicate(timeout=15)
        assert process.returncode == 0, error
        if operation == "explain":
            assert str(root / name / "code").replace(str(tmp_path), "~") in output
    for name in NAMES:
        config = yaml.safe_load((root / name / "project.yaml").read_text())
        assert "project" not in config
        if operation == "github":
            assert config["github"]["repository"] == f"team/{name}"
        if operation == "linear":
            assert config["linear"] == {"project_id": f"{name}-project", "team_id": f"{name}-team"}
    for path, original in sentinels.items():
        assert path.read_bytes() == original
    assert not (root / ".config.json").exists()
    assert not (root / ".config.lock").exists()
