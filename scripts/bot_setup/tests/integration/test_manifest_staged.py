"""Staged-manifest validation reads the real Git index (hermetic git, no repository from the caller)."""

import os
import shutil

import click
import pytest

from bot_setup import skills
from hermetic_git import run_git
from skill_fixtures import manifest_catalog

pytestmark = [pytest.mark.integration, pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")]


@pytest.fixture(autouse=True)
def hermetic_git_env(monkeypatch):
    """skills.check_manifests runs git itself; it must see only this test's repository, never an outer hook index."""
    for name in [name for name in os.environ if name.startswith("GIT_")]:
        monkeypatch.delenv(name)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)


def test_index_content_is_not_repaired_by_working_tree(tmp_path):
    hub, manifest = manifest_catalog(tmp_path)
    git = lambda *args: run_git(*args, cwd=tmp_path, check=True, capture_output=True)
    git("init", "-q")
    git("add", ".")
    manifest.write_text('[skills]\ninclude=["missing"]')
    skills.check_manifests(tmp_path, staged=True)
    git("add", ".")
    manifest.write_text('[skills]\ninclude=["research"]')
    with pytest.raises(click.ClickException):
        skills.check_manifests(tmp_path, staged=True)
    git("add", ".")
    (hub / "research/SKILL.md").unlink()
    git("add", ".")
    (hub / "research/SKILL.md").write_text("unstaged repair")
    with pytest.raises(click.ClickException):
        skills.check_manifests(tmp_path, staged=True)


@pytest.mark.parametrize("target", ["manifest", "entry"])
def test_staged_symlinks_are_not_regular_manifest_or_entry_files(tmp_path, target):
    hub, manifest = manifest_catalog(tmp_path)
    file = manifest if target == "manifest" else hub / "research/SKILL.md"
    saved = tmp_path / "saved"
    file.rename(saved)
    file.symlink_to(saved)
    run_git("init", "-q", cwd=tmp_path, check=True)
    run_git("add", ".", cwd=tmp_path, check=True)
    with pytest.raises(click.ClickException):
        skills.check_manifests(tmp_path, staged=True)
