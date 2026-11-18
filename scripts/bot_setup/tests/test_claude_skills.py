"""Claude Code skills are shared from a skill catalog without overwriting host files."""

import os
from pathlib import Path

import click
import pytest

from bot_setup.claude_skills import claude_dir, install_claude_skills
from bot_setup.manifest import parse_manifest


def manifest(names):
    return parse_manifest(f'''
[claude]
skills = {names!r}
[skills]
include = []
'''.replace("'", '"'), "fixture.toml")


def prepared(catalog: Path, name="research"):
    skill = catalog / name
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("skill")
    (skill / "references/notes.md").write_text("notes")
    return skill


def test_skill_tree_is_copied_into_claude_directory(tmp_path):
    prepared(tmp_path / "catalog")
    results = install_claude_skills(tmp_path / "catalog", manifest(["research"]), tmp_path / "home")
    root = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "skills/research"
    assert (root / "SKILL.md").read_text() == "skill"
    assert (root / "references/notes.md").read_text() == "notes"
    assert all(created for _, created in results) and len(results) == 2


def test_existing_files_are_preserved_and_reported(tmp_path):
    prepared(tmp_path / "catalog")
    target = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "skills/research/SKILL.md"
    target.parent.mkdir(parents=True)
    target.write_text("customized")
    results = install_claude_skills(tmp_path / "catalog", manifest(["research"]), tmp_path / "home")
    assert target.read_text() == "customized"
    assert (target, False) in results


def test_manifest_without_claude_section_installs_nothing(tmp_path):
    assert install_claude_skills(tmp_path, parse_manifest("[skills]\ninclude = []", "f.toml"), tmp_path) == []


def test_unprepared_skill_fails_before_writing(tmp_path):
    with pytest.raises(click.ClickException):
        install_claude_skills(tmp_path / "catalog", manifest(["research"]), tmp_path / "home")
    assert not (Path(os.environ["CLAUDE_CONFIG_DIR"]) / "skills").exists()


def test_claude_config_dir_overrides_home(monkeypatch, tmp_path):
    monkeypatch.delenv("CLAUDE_CONFIG_DIR")
    assert claude_dir(tmp_path) == tmp_path / ".claude"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "other"))
    assert claude_dir(tmp_path) == tmp_path / "other"


def test_skill_names_must_be_kebab_case():
    with pytest.raises(click.ClickException):
        manifest(["../research"])
