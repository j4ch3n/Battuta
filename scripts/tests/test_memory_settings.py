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

    def test_missing_settings_are_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            configure_memory_settings(Path(directory))
            self.assertFalse((Path(directory) / ".pi/settings.json").exists())

    def test_invalid_packages_are_rejected_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            path = bot / ".pi/settings.json"
            path.parent.mkdir()
            path.write_text('{"packages": {}}')
            with self.assertRaises(click.ClickException):
                configure_memory_settings(bot)
            self.assertEqual(path.read_text(), '{"packages": {}}')
