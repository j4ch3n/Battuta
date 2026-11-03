"""Runtime catalog metadata and complete bot discovery resources."""

from pathlib import Path
import re
import unittest
from bot_setup.skills import check_manifests

ROOT = Path(__file__).resolve().parents[3]


class SkillCatalogTests(unittest.TestCase):
    def test_catalog_has_unique_valid_entry_points(self):
        hub = ROOT / "skills-hub"
        self.assertTrue(hub.is_dir())
        names = []
        for skill in hub.iterdir():
            if not skill.is_dir():
                continue
            with self.subTest(skill=skill.name):
                self.assertRegex(skill.name, r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
                entry = skill / "SKILL.md"
                self.assertTrue(entry.is_file())
                metadata = entry.read_text().split("---", 2)[1]
                name = re.search(r"^name:\s*(\S+)\s*$", metadata, re.MULTILINE)
                self.assertIsNotNone(name)
                self.assertEqual(name.group(1), skill.name)
                names.append(name.group(1))
        self.assertEqual(len(names), len(set(names)))

    def test_bot_selections_validate_without_discovery_output(self):
        check_manifests(ROOT)
        for role in ("cos", "manager"):
            skills = ROOT / f"bots/{role}-bot/.pi/skills"
            self.assertFalse(skills.exists() and any(skills.iterdir()))
