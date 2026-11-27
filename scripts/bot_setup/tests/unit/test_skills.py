"""Local setup exposes selected catalog skills through generated links."""

import click
import pytest

from bot_setup.instructions import configure_instructions
from skill_fixtures import skill_catalog, manifest_text


@pytest.mark.parametrize("role", ["cos", "manager"])
@pytest.mark.parametrize("names", [["research", "note-taking"], []])
def test_source_setup_links_selected_skills_idempotently(tmp_path, role, names):
    skill_catalog(tmp_path, role, names)
    bot = tmp_path / f"bots/{role}-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    manifest = bot / "bot.toml"
    before = manifest.read_bytes()
    for _ in range(2):
        configure_instructions(bot, role=role, root=tmp_path)
        skills = bot / ".pi/skills"
        assert {entry.name for entry in skills.iterdir()} == set(names)
        for name in names:
            assert (skills / name).is_symlink()
            assert (skills / name).resolve() == tmp_path / "skills-hub" / name
        assert manifest.read_bytes() == before
        assert (bot / "AGENTS.md").read_text() == "Shared\nDedicated"


def test_invalid_selection_does_not_write_instructions(tmp_path):
    skill_catalog(tmp_path, "cos")
    bot = tmp_path / "bots/cos-bot"
    (bot / "bot.toml").write_text('[skills]\ninclude=["missing"]')
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    with pytest.raises(click.ClickException):
        configure_instructions(bot, role="cos", root=tmp_path)
    assert not (bot / "AGENTS.md").exists()
    assert not (bot / ".pi").exists()


def test_custom_workspace_manifest_controls_local_discovery(tmp_path):
    skill_catalog(tmp_path, "cos")
    bot = tmp_path / "custom"
    bot.mkdir()
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (bot / "bot.toml").write_text(manifest_text("cos", ["note-taking"]))
    configure_instructions(bot, role="cos", root=tmp_path)
    assert {entry.name for entry in (bot / ".pi/skills").iterdir()} == {"note-taking"}


def test_reselection_removes_only_owned_links_and_preserves_custom_content(tmp_path):
    skill_catalog(tmp_path, "manager", ["research", "note-taking"])
    bot = tmp_path / "bots/manager-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    configure_instructions(bot, role="manager", root=tmp_path)
    skills = bot / ".pi/skills"
    custom = skills / "custom"
    custom.write_text("Private content")
    (bot / "bot.toml").write_text(manifest_text("manager", ["research"]))
    configure_instructions(bot, role="manager", root=tmp_path)
    assert (skills / "research").is_symlink()
    assert not (skills / "note-taking").exists()
    assert custom.read_text() == "Private content"


@pytest.mark.parametrize("kind", ["file", "directory", "link", "root-link"])
def test_custom_skill_content_is_never_replaced(tmp_path, kind):
    skill_catalog(tmp_path, "manager", ["research"])
    bot = tmp_path / "bots/manager-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    outside = tmp_path / "custom"
    outside.mkdir()
    (outside / "private").write_text("Preserve")
    skills = bot / ".pi/skills"
    skills.parent.mkdir()
    if kind == "root-link":
        skills.symlink_to(outside, target_is_directory=True)
    else:
        skills.mkdir()
        target = skills / "research"
        if kind == "file":
            target.write_text("Preserve")
        elif kind == "directory":
            target.mkdir()
            (target / "private").write_text("Preserve")
        else:
            target.symlink_to(outside, target_is_directory=True)
    with pytest.raises(click.ClickException):
        configure_instructions(bot, role="manager", root=tmp_path)
    assert (outside / "private").read_text() == "Preserve"
    assert (tmp_path / "skills-hub/research/SKILL.md").is_file()
    if kind == "file":
        assert (skills / "research").read_text() == "Preserve"
    elif kind == "directory":
        assert (skills / "research/private").read_text() == "Preserve"
