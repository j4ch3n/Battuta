"""Native TL subagent setup preserves private state and limits child extensions."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SubagentSetupTests(unittest.TestCase):
    def configure(self, bot):
        return subprocess.run(
            ["node", str(ROOT / "packaging/configure-subagents.mjs"), str(bot)],
            capture_output=True, text=True,
        )

    def test_fresh_setup_creates_native_settings_without_a_private_grant(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            result = self.configure(bot)
            self.assertEqual(result.returncode, 0, result.stderr)
            path = bot / ".pi/settings.json"
            settings = json.loads(path.read_text())
            self.assertEqual(settings["packages"], ["npm:pi-subagents@0.82.1"])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse((bot / ".pi/subagents.json").exists())

    def test_native_registration_and_web_only_defaults_preserve_private_state(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            private = bot / ".pi"
            private.mkdir()
            settings = {"packages": ["npm:custom@1.0.0"], "extensions": ["./custom.ts"], "theme": "custom"}
            (private / "settings.json").write_text(json.dumps(settings))
            for name in ("auth.json", "subagents.json", "telegram.json"):
                (private / name).write_text("private sentinel")
            for _ in range(2):
                result = self.configure(bot)
                self.assertEqual(result.returncode, 0, result.stderr)
            updated = json.loads((private / "settings.json").read_text())
            self.assertEqual(updated["packages"], ["npm:custom@1.0.0", "npm:pi-subagents@0.82.1"])
            self.assertEqual(updated["extensions"], ["./custom.ts"])
            self.assertEqual(updated["theme"], "custom")
            self.assertEqual(updated["subagents"]["defaultExtensions"], [str(private / "npm/node_modules/pi-web-access/dist")])
            self.assertNotIn("defaultSubagentOnlyExtensions", updated["subagents"])
            for profile in ("scout", "worker", "reviewer"):
                role = updated["subagents"]["agentOverrides"][profile]
                self.assertIn("web_search", role["tools"])
                self.assertIn("fetch_content", role["tools"])
                self.assertFalse(role["inheritProjectContext"])
                self.assertFalse(role["inheritSkills"])
            for name in ("auth.json", "subagents.json", "telegram.json"):
                self.assertEqual((private / name).read_text(), "private sentinel")

    def test_existing_native_customization_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            (bot / ".pi").mkdir()
            settings = {"subagents": {"defaultExtensions": [], "agentOverrides": {"worker": {"tools": ["read"]}}}}
            (bot / ".pi/settings.json").write_text(json.dumps(settings))
            self.assertEqual(self.configure(bot).returncode, 0)
            updated = json.loads((bot / ".pi/settings.json").read_text())
            self.assertEqual(updated["subagents"]["defaultExtensions"], [])
            self.assertEqual(updated["subagents"]["agentOverrides"]["worker"]["tools"], ["read"])

    def test_only_obsolete_adapter_registration_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            (bot / ".pi").mkdir()
            path = bot / ".pi/settings.json"
            path.write_text(json.dumps({"extensions": ["/old/bots/tl-bot/.pi/extensions/bounded-subagents/index.ts", "./custom.ts"]}))
            self.assertEqual(self.configure(bot).returncode, 0)
            self.assertEqual(json.loads(path.read_text())["extensions"], ["./custom.ts"])

    def test_invalid_native_configuration_is_preserved(self):
        for value in ("{", "[]", '{"subagents": []}', '{"packages": {}}'):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory)
                (bot / ".pi").mkdir()
                path = bot / ".pi/settings.json"
                path.write_text(value)
                self.assertNotEqual(self.configure(bot).returncode, 0)
                self.assertEqual(path.read_text(), value)
