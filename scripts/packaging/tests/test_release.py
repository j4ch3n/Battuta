"""Release provenance rejects dirty trees and invalid tags before assembly."""

import os
from pathlib import Path
import subprocess

import yaml


ROOT = Path(__file__).resolve().parents[3]


def test_release_provenance_fails_closed(tmp_path):
    workflow = yaml.safe_load((ROOT / ".github/workflows/release.yml").read_text())
    script = next(step["run"] for step in workflow["jobs"]["prepare"]["steps"] if step.get("id") == "version")
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True, stderr=subprocess.DEVNULL).strip()
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Release test")
    (tmp_path / "source").write_text("release")
    git("add", "source")
    git("commit", "-m", "fixture")
    git("tag", "v1.2.3")
    git("remote", "add", "origin", str(tmp_path))
    output = tmp_path.parent / (tmp_path.name + "-outputs")
    env = {**os.environ, "TAG": "v1.2.3", "GITHUB_OUTPUT": str(output)}
    result = subprocess.run(["bash", "-c", script], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert output.read_text() == f"version=1.2.3+g{git('rev-parse', '--short', 'HEAD')}\n"
    (tmp_path / "source").write_text("dirty")
    output.unlink()
    result = subprocess.run(["bash", "-c", script], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert not output.exists()
