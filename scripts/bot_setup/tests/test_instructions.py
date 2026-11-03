"""Instruction assembly uses owned sources and leaves private content alone."""

import pytest

from bot_setup.instructions import configure_instructions
from skill_fixtures import skill_catalog


@pytest.mark.parametrize("role", ["pm", "tl"])
def test_custom_workspace_assembles_sources_and_preserves_private_files(tmp_path, role):
    skill_catalog(tmp_path, role)
    bot = tmp_path / "custom assistant"
    (bot / ".pi").mkdir(parents=True)
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared fixture")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated fixture")
    private = bot / ".pi/ME.md"
    private.write_text("Private guidance")
    for _ in range(2):
        configure_instructions(bot, role=role, root=tmp_path)
        assert (bot / "AGENTS.md").read_text() == "Shared fixture\nDedicated fixture"
        assert private.read_text() == "Private guidance"
        assert not (bot / ".pi/skills").exists()
