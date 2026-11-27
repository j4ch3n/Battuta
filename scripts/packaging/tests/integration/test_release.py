"""Release provenance rejects dirty trees and invalid tags before assembly."""

from pathlib import Path
import subprocess

import pytest
import yaml

from hermetic_git import git_env, requires_git, run_git

pytestmark = [pytest.mark.integration, requires_git]

ROOT = Path(__file__).resolve().parents[4]


def assert_provenance_fails_closed(tmp_path):
    workflow = yaml.safe_load((ROOT / ".github/workflows/release.yml").read_text())
    script = next(step["run"] for step in workflow["jobs"]["prepare"]["steps"] if step.get("id") == "version")
    def git(*args):
        return run_git(*args, cwd=tmp_path, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.strip()
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Release test")
    (tmp_path / "source").write_text("release")
    git("add", "source")
    git("commit", "-m", "fixture")
    git("tag", "v1.2.3")
    git("remote", "add", "origin", str(tmp_path))
    output = tmp_path.parent / (tmp_path.name + "-outputs")
    env = git_env(TAG="v1.2.3", GITHUB_OUTPUT=str(output))
    result = subprocess.run(["bash", "-c", script], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert output.read_text() == f"version=1.2.3+g{git('rev-parse', '--short', 'HEAD')}\n"
    (tmp_path / "source").write_text("dirty")
    output.unlink()
    result = subprocess.run(["bash", "-c", script], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert not output.exists()


def test_release_provenance_fails_closed(tmp_path):
    assert_provenance_fails_closed(tmp_path)


def test_release_provenance_fails_closed(tmp_path):
    assert_provenance_fails_closed(tmp_path)


def test_release_provenance_ignores_outer_git_repository(tmp_path, monkeypatch):
    decoy = tmp_path / "decoy"
    run_git("init", "-q", "-b", "main", str(decoy), cwd=tmp_path, check=True)
    run_git("-c", "user.name=Decoy", "-c", "user.email=decoy@example.com", "commit", "-q", "--allow-empty", "-m", "decoy", cwd=decoy, check=True)

    def snapshot():
        def read(*args):
            return run_git(*args, cwd=decoy, check=True, capture_output=True, text=True).stdout
        return (decoy / ".git/config").read_bytes(), read("tag", "-l"), read("rev-parse", "HEAD")

    before = snapshot()
    monkeypatch.setenv("GIT_DIR", str(decoy / ".git"))
    monkeypatch.setenv("GIT_WORK_TREE", str(decoy))
    monkeypatch.setenv("GIT_INDEX_FILE", str(decoy / ".git/index"))
    work = tmp_path / "work"
    work.mkdir()
    assert_provenance_fails_closed(work)
    monkeypatch.undo()
    assert snapshot() == before
