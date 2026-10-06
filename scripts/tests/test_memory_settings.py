"""The bridge replaces direct Stone resources without touching other packages."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

import click

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.memory import configure_memory_settings  # noqa: E402


class MemorySettingsTests(unittest.TestCase):
    def test_removes_only_direct_stone_package_and_preserves_configuration(self):
        for package in ("npm:pi-memory-stone@0.1.7", {"source": "npm:pi-memory-stone@0.1.7", "extensions": ["src/index.ts"]}):
            with self.subTest(package=package), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory)
                path = bot / ".pi/settings.json"
                path.parent.mkdir()
                path.write_text(json.dumps({"packages": [package, "npm:pi-memory-stone-extra", "npm:custom"], "theme": "dark", "battutaMemory": {"includeGlobal": False}}))
                for _ in range(2):
                    configure_memory_settings(bot)
                    self.assertEqual(json.loads(path.read_text()), {"packages": ["npm:pi-memory-stone-extra", "npm:custom"], "theme": "dark", "battutaMemory": {"includeGlobal": False}})

    def test_role_capability_preserves_profile_and_other_memory_settings(self):
        for role in ("pm-bot", "tl-bot"):
            for retained_profile in (None, "Private owner understanding"):
                with self.subTest(role=role, profile=retained_profile), tempfile.TemporaryDirectory() as directory:
                    bot = Path(directory) / role
                    path = bot / ".pi/settings.json"
                    path.parent.mkdir(parents=True)
                    path.write_text(json.dumps({"theme": "dark", "battutaMemory": {"maxTokens": 700, "ownerProfile": role != "pm-bot"}}))
                    profile = path.parent / "ME.md"
                    if retained_profile:
                        profile.write_text(retained_profile)
                    for _ in range(2):
                        configure_memory_settings(bot)
                        self.assertEqual(json.loads(path.read_text()), {"theme": "dark", "battutaMemory": {"maxTokens": 700, "ownerProfile": role == "pm-bot"}})
                        self.assertEqual(profile.read_text() if profile.exists() else None, retained_profile)

    def test_missing_role_settings_enable_only_pm_profile_without_seeding(self):
        for role in ("pm-bot", "tl-bot"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory) / role
                configure_memory_settings(bot)
                self.assertEqual(json.loads((bot / ".pi/settings.json").read_text()), {"battutaMemory": {"ownerProfile": role == "pm-bot"}})
                self.assertFalse((bot / ".pi/ME.md").exists())

    def test_invalid_packages_are_rejected_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            path = bot / ".pi/settings.json"
            path.parent.mkdir()
            path.write_text('{"packages": {}}')
            with self.assertRaises(click.ClickException):
                configure_memory_settings(bot)
            self.assertEqual(path.read_text(), '{"packages": {}}')
