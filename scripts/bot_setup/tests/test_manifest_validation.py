"""Manifest validation uses strict data and the actual staged index."""

import json
from pathlib import Path
import subprocess

import click
import pytest

from bot_setup import skills


def catalog(tmp_path):
    hub = tmp_path / "skills-hub"
    for name in ("research", "note-taking"):
        source = hub / name
        source.mkdir(parents=True)
        (source / "SKILL.md").write_text(f"---\nname: {name}\n---\n")
    manifest = tmp_path / "bots/example/bot.toml"
    manifest.parent.mkdir(parents=True)
    manifest.write_text('[skills]\ninclude = ["research"]\n')
    return hub, manifest


@pytest.mark.parametrize("text", ["{", "null", "[]", "", '[skills]\ninclude=[]\nrole="cos"', '[skills]\ninclude="research"', '[skills]\ninclude=[1]', '[skills]\ninclude=["research","research"]', '[skills]\ninclude=["missing"]', '[skills]\ninclude=["../research"]', '[skills]\ninclude=["/research"]', '[skills]\ninclude=["Research"]'])
def test_invalid_manifest_is_rejected(tmp_path, text):
    hub, manifest = catalog(tmp_path)
    manifest.write_text(text)
    with pytest.raises(click.ClickException):
        skills.load_selection(manifest, hub)


@pytest.mark.parametrize("names", [["note-taking", "research"], []])
def test_selection_preserves_order_and_accepts_empty(tmp_path, names):
    hub, manifest = catalog(tmp_path)
    manifest.write_text("[skills]\ninclude = " + json.dumps(names))
    assert skills.load_selection(manifest, hub) == names


def test_escaping_or_missing_entry_is_rejected(tmp_path):
    hub, manifest = catalog(tmp_path)
    entry = hub / "research/SKILL.md"
    entry.unlink()
    with pytest.raises(click.ClickException):
        skills.load_selection(manifest, hub)
    outside = tmp_path / "outside.md"
    outside.write_text("outside")
    entry.symlink_to(outside)
    with pytest.raises(click.ClickException):
        skills.load_selection(manifest, hub)


def test_index_content_is_not_repaired_by_working_tree(tmp_path):
    hub, manifest = catalog(tmp_path)
    git = lambda *args: subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)
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


def test_all_profiles_include_worker(tmp_path):
    catalog(tmp_path)
    skills.check_manifests(tmp_path)
    worker = tmp_path / "bots/worker/bot.toml"
    worker.parent.mkdir()
    worker.write_text('[skills]\ninclude=["missing"]')
    with pytest.raises(click.ClickException):
        skills.check_manifests(tmp_path)


@pytest.mark.parametrize("target", ["manifest", "entry"])
def test_staged_symlinks_are_not_regular_manifest_or_entry_files(tmp_path, target):
    hub, manifest = catalog(tmp_path)
    file = manifest if target == "manifest" else hub / "research/SKILL.md"
    saved = tmp_path / "saved"
    file.rename(saved)
    file.symlink_to(saved)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    with pytest.raises(click.ClickException):
        skills.check_manifests(tmp_path, staged=True)
