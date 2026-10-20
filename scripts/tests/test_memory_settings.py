"""Breaking replacement removes owned legacy settings without touching owner files."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

import click

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.memory import configure_memory_settings  # noqa: E402


class MemorySettingsTests(unittest.TestCase):
    def test_tl_setup_disables_capture_in_arbitrary_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory) / "custom-installation"
            path = bot / ".pi/settings.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"battutaMemoryCapture": {"enabled": True, "batchMessages": 4}}))
            configure_memory_settings(bot, role="tl")
            self.assertEqual(json.loads(path.read_text()), {"battutaMemoryCapture": {"enabled": False, "batchMessages": 4}})

    def test_removes_only_direct_stone_package_and_preserves_configuration(self):
        for package in ("npm:pi-memory-stone@0.1.7", {"source": "npm:pi-memory-stone@0.1.7", "extensions": ["src/index.ts"]}):
            with self.subTest(package=package), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory)
                path = bot / ".pi/settings.json"
                path.parent.mkdir()
                path.write_text(json.dumps({"packages": [package, "npm:pi-memory-stone-extra", "npm:custom"], "theme": "dark", "battutaMemory": {"includeGlobal": False}}))
                for _ in range(2):
                    configure_memory_settings(bot, role="pm")
                    self.assertEqual(json.loads(path.read_text()), {"packages": ["npm:pi-memory-stone-extra", "npm:custom"], "theme": "dark", "battutaMemoryCapture": {"enabled": True, "batchMessages": 6}})

    def test_both_roles_discard_old_settings_and_preserve_profile(self):
        for role in ("pm", "tl"):
            for retained_profile in (None, "Private owner understanding"):
                with self.subTest(role=role, profile=retained_profile), tempfile.TemporaryDirectory() as directory:
                    bot = Path(directory) / role
                    path = bot / ".pi/settings.json"
                    path.parent.mkdir(parents=True)
                    path.write_text(json.dumps({"theme": "dark", "battutaMemory": {"maxTokens": 700, "ownerProfile": role != "pm"}}))
                    profile = path.parent / "ME.md"
                    if retained_profile:
                        profile.write_text(retained_profile)
                    for _ in range(2):
                        configure_memory_settings(bot, role=role)
                        self.assertEqual(json.loads(path.read_text()), {"theme": "dark", "battutaMemoryCapture": {"enabled": role == "pm", "batchMessages": 6}})
                        self.assertEqual(profile.read_text() if profile.exists() else None, retained_profile)

    def test_missing_settings_apply_role_capture_defaults_without_seeding_profile(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory) / role
                configure_memory_settings(bot, role=role)
                self.assertEqual(json.loads((bot / ".pi/settings.json").read_text()), {"battutaMemoryCapture": {"enabled": role == "pm", "batchMessages": 6}})
                self.assertFalse((bot / ".pi/ME.md").exists())

    def test_invalid_packages_are_rejected_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            path = bot / ".pi/settings.json"
            path.parent.mkdir()
            path.write_text('{"packages": {}}')
            with self.assertRaises(click.ClickException):
                configure_memory_settings(bot, role="pm")
            self.assertEqual(path.read_text(), '{"packages": {}}')

    def test_role_capture_policy_preserves_batch_size_and_pm_toggle(self):
        for role, old_enabled, enabled in (("pm", True, True), ("pm", False, False), ("tl", True, False), ("tl", False, False)):
            with self.subTest(role=role, old_enabled=old_enabled), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory) / role
                path = bot / ".pi/settings.json"
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({"battutaMemoryCapture": {"enabled": old_enabled, "batchMessages": 4}}))
                for _ in range(2):
                    configure_memory_settings(bot, role=role)
                    self.assertEqual(json.loads(path.read_text()), {"battutaMemoryCapture": {"enabled": enabled, "batchMessages": 4}})
