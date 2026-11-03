"""Skill selection is validated metadata, never discovery output."""

import json

import click
import pytest

from bot_setup.instructions import configure_instructions
from skill_fixtures import skill_catalog


@pytest.mark.parametrize("role", ["pm", "tl"])
@pytest.mark.parametrize("names", [["memory", "note-taking"], []])
def test_setup_validates_selection_without_materializing_it(tmp_path, role, names):
    skill_catalog(tmp_path, role, names)
    bot = tmp_path / f"bots/{role}-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    manifest = bot / "skills.json"
    before = manifest.read_bytes()
    for _ in range(2):
        configure_instructions(bot, role=role, root=tmp_path)
        assert not (bot / ".pi/skills").exists()
        assert manifest.read_bytes() == before
        assert (bot / "AGENTS.md").read_text() == "Shared\nDedicated"


def test_invalid_selection_does_not_write_instructions(tmp_path):
    skill_catalog(tmp_path, "pm")
    bot = tmp_path / "bots/pm-bot"
    (bot / "skills.json").write_text(json.dumps({"skills": ["missing"]}))
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    with pytest.raises(click.ClickException):
        configure_instructions(bot, role="pm", root=tmp_path)
    assert not (bot / "AGENTS.md").exists()
    assert not (bot / ".pi").exists()


def test_custom_workspace_manifest_is_validated_without_discovery(tmp_path):
    skill_catalog(tmp_path, "pm")
    bot = tmp_path / "custom"
    bot.mkdir()
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (bot / "skills.json").write_text('{"skills":["note-taking"]}')
    configure_instructions(bot, role="pm", root=tmp_path)
    assert not (bot / ".pi").exists()
