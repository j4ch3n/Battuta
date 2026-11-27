"""Runtime catalog metadata and complete bot discovery resources."""

from pathlib import Path
import re

import pytest

ROOT = Path(__file__).resolve().parents[4]
HUB = ROOT / "skills-hub"
SKILLS = sorted(path for path in HUB.iterdir() if path.is_dir())


def test_catalog_lists_skills():
    assert SKILLS


@pytest.mark.parametrize("skill", SKILLS, ids=lambda skill: skill.name)
def test_catalog_entry_point_is_valid_and_matches_directory(skill):
    assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", skill.name)
    entry = skill / "SKILL.md"
    assert entry.is_file()
    metadata = entry.read_text().split("---", 2)[1]
    name = re.search(r"^name:\s*(\S+)\s*$", metadata, re.MULTILINE)
    assert name
    assert name.group(1) == skill.name

