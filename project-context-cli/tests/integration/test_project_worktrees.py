"""Worktree commands against a real temporary git checkout."""

import json
import os
import subprocess

from click.testing import CliRunner
import pytest

from battuta_project.cli import main
from battuta_project.registry import ProjectRegistry

pytestmark = pytest.mark.integration


@pytest.fixture
def project(home, monkeypatch):
    # Git hooks export GIT_DIR/GIT_INDEX_FILE, which would redirect these tests' own repositories.
    for key in [key for key in os.environ if key.startswith("GIT_")]:
        monkeypatch.delenv(key)
    monkeypatch.setenv("LINEAR_API_TOKEN", "test-token")
    project = ProjectRegistry().init("atlas-api")
    git = ["git", "-C", str(project.code), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q", "-b", "main"], check=True)
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "init"], check=True)
    return project


@pytest.fixture
def run_cli(project):
    def run(*args, ok=True):
        result = CliRunner().invoke(main, ["worktree", *args])
        assert (result.exit_code == 0) == ok, result.output
        return result.output
    return run


def git_output(path, *args):
    return subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True).stdout


def test_create_places_worktree_under_project_on_agent_branch(project, run_cli):
    run_cli("create", "atlas-api", "fix-login")
    path = project.root / "worktrees" / "fix-login"
    assert (path / ".git").exists()
    assert git_output(path, "branch", "--show-current").strip() == "agent/fix-login"
    assert git_output(project.code, "status", "--porcelain") == ""


@pytest.mark.parametrize("name", ["../escape", "Upper", "a b", "-lead", "double--hyphen"],
                         ids=["traversal", "uppercase", "space", "leading-hyphen", "double-hyphen"])
def test_create_rejects_bad_names(run_cli, name):
    run_cli("create", "atlas-api", "--", name, ok=False)


def test_create_rejects_existing_worktree(run_cli):
    run_cli("create", "atlas-api", "one")
    run_cli("create", "atlas-api", "one", ok=False)


def test_list_reports_only_managed_worktrees_with_dirty_state(project, run_cli):
    run_cli("create", "atlas-api", "clean-one")
    run_cli("create", "atlas-api", "dirty-one", "--branch", "custom/dirty")
    (project.root / "worktrees" / "dirty-one" / "x.txt").write_text("x")
    listed = {w["name"]: w for w in json.loads(run_cli("list", "atlas-api", "--json"))["worktrees"]}
    assert set(listed) == {"clean-one", "dirty-one"}
    assert (listed["clean-one"]["dirty"], listed["dirty-one"]["dirty"]) == (False, True)
    assert listed["dirty-one"]["branch"] == "custom/dirty"


def test_delete_refuses_dirty_unless_forced_and_keeps_branch(project, run_cli):
    run_cli("create", "atlas-api", "wip")
    path = project.root / "worktrees" / "wip"
    (path / "x.txt").write_text("x")
    run_cli("delete", "atlas-api", "wip", ok=False)
    assert path.exists()
    run_cli("delete", "atlas-api", "wip", "--force")
    assert not path.exists()
    assert "agent/wip" in git_output(project.code, "branch", "--list", "agent/wip")
    assert json.loads(run_cli("list", "atlas-api", "--json")) == {"worktrees": []}


def test_unknown_project_and_missing_worktree_fail(run_cli):
    run_cli("create", "missing", "x", ok=False)
    run_cli("delete", "atlas-api", "nothing", ok=False)
