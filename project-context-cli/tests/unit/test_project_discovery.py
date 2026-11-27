"""Filesystem project discovery without workspace changes."""

import json
from pathlib import Path
import shutil

import pytest

from battuta_project.cli import main
from battuta_project.models import ProjectList
from battuta_project.presentation import render


def test_list_sorts_projects_and_renders_both_home_relative_paths(invoke, project, registry, linear_http):
    registry.init("harbor-web", github="https://github.com/team/harbor-web")
    registry.init("aardvark", github="https://github.com/team/aardvark")
    with linear_http() as requests:
        output = invoke("list")
    lines = output.splitlines()
    assert [line for line in lines if line.startswith(("1.", "2.", "3."))] == [
        "1. **aardvark**", "2. **atlas-api**", "3. **harbor-web**",
    ]
    for name in ("aardvark", "atlas-api", "harbor-web"):
        assert f"   Project Root: ~/.battuta/projects/{name}" in lines
        assert f"   Code: ~/.battuta/projects/{name}/code" in lines
    assert requests == []


def test_discovery_requires_project_yaml(invoke, project, registry):
    (registry.root / "unregistered").mkdir()
    (registry.root / ".hidden").mkdir()
    (registry.root / "notes.txt").write_text("Notes")
    (registry.root / "alias").symlink_to(project.root, target_is_directory=True)
    output = invoke("list")
    assert "1. **atlas-api**" in output
    assert "2." not in output
    assert not (registry.root / ".config.json").exists()


@pytest.mark.parametrize("exists", [False, True], ids=["missing-store", "empty-registry"])
def test_list_empty_or_missing_registry_does_not_create_state(invoke, project, registry, exists):
    shutil.rmtree(registry.root)
    if exists:
        registry.root.mkdir()
    output = invoke("list")
    assert ("No registered projects" if exists else "No Battuta project store has been initialized") in output
    assert "battuta-project init <project-name>" in output
    assert json.loads(invoke("list", "--json")) == {"projects": []}
    assert registry.root.exists() == exists
    assert not (registry.root / ".config.json").exists()


@pytest.mark.parametrize("args", [["list"], ["list", "--json"]], ids=["text", "json"])
def test_list_reports_invalid_registration_without_mutation(runner, project, args):
    (project.root / "project.yaml").write_text("invalid: true")
    result = runner.invoke(main, args)
    assert result.exit_code != 0
    assert "project.yaml" in result.output
    assert (project.root / "project.yaml").read_text() == "invalid: true"


def test_list_json_is_complete_and_non_mutating(invoke, project, registry, home):
    for name in ("Atlas", "my project", "项目", "global"):
        registry.init(name)
    before = {str(p): p.read_bytes() for p in home.rglob("*") if p.is_file()}
    assert json.loads(invoke("list", "--json")) == {"projects": ["Atlas", "atlas-api", "global", "my project", "项目"]}
    assert {str(p): p.read_bytes() for p in home.rglob("*") if p.is_file()} == before


def test_list_rejects_root_override(runner, home):
    root = home / "custom"
    result = runner.invoke(main, ["list", "--json", "--root", str(root)])
    assert result.exit_code != 0
    assert "No such option" in result.output
    assert not root.exists()


@pytest.mark.parametrize("state", ["directory", "symlink", "broken-symlink", "malformed", "missing-checkout", "symlink-checkout"],
                         ids=["directory", "symlink-to-file", "broken-symlink", "malformed", "missing-checkout", "symlink-checkout"])
def test_list_rejects_unsafe_markers_or_broken_checkouts(runner, project, home, state):
    path = project.root / "project.yaml"
    if state == "directory":
        path.unlink()
        path.mkdir()
    elif state in ("symlink", "broken-symlink"):
        path.unlink()
        target = home / "target.yaml"
        target.write_text("version: 1\n")
        path.symlink_to(target if state == "symlink" else home / "absent")
    elif state == "malformed":
        path.write_text("not: valid: yaml")
    else:
        project.code.rmdir()
        if state == "symlink-checkout":
            project.code.symlink_to(home, target_is_directory=True)
    result = runner.invoke(main, ["list", "--json"])
    assert result.exit_code != 0
    assert str(project.root) in result.output


def test_list_preserves_absolute_paths_outside_home(project, home, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home / "different-home"))
    output = render("list.md.j2", ProjectList(projects=[project]))
    lines = output.splitlines()
    assert lines[0].startswith("1. **atlas-api**")
    assert f"   Project Root: {project.root}" in lines
    assert f"   Code: {project.code}" in lines
    assert "~" not in output


def test_list_rejects_project_arguments(runner, project):
    result = runner.invoke(main, ["list", "atlas-api"])
    assert result.exit_code != 0
    assert "unexpected extra argument" in result.output


@pytest.mark.parametrize("state, expected", [
    ("missing store", "No Battuta project store has been initialized"),
    ("empty registry", "No registered projects"),
    ("unknown", "Project 'Battuta' is not registered"),
], ids=["missing-store", "empty-registry", "unknown"])
def test_named_project_errors_distinguish_store_empty_and_unknown(runner, project, registry, home, state, expected):
    if state != "unknown":
        shutil.rmtree(registry.root)
    if state == "empty registry":
        registry.root.mkdir()
    before = sorted(home.rglob("*"))
    result = runner.invoke(main, ["explain", "Battuta"])
    assert result.exit_code != 0
    assert expected in result.output
    assert "battuta-project init <project-name>" in result.output
    if state == "unknown":
        assert "battuta-project list" in result.output
    assert sorted(home.rglob("*")) == before
