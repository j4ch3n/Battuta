"""Runtime catalog metadata and complete bot discovery resources."""

from pathlib import Path
import re
import shutil
import tempfile
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
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "skills-hub", root / "skills-hub")
            for manifest in (ROOT / "bots").glob("*/skills.json"):
                target = root / manifest.relative_to(ROOT)
                target.parent.mkdir(parents=True)
                shutil.copy2(manifest, target)
            check_manifests(root)
            self.assertFalse(any((root / "bots").glob("*/.pi")))
