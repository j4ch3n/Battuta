"""TL-only adapter setup preserves operator extensions and private grants."""
import json
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from bot_setup.subagents import configure_subagents


class SubagentSetupTests(unittest.TestCase):
    def test_custom_workspace_preserves_plugins_credentials_and_grant(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            private = bot / ".pi"
            private.mkdir()
            settings = {"packages": ["npm:custom@1.0.0"], "extensions": ["./custom.ts"], "theme": "custom"}
            (private / "settings.json").write_text(json.dumps(settings))
            for name in ("auth.json", "subagents.json", "telegram.json"):
                (private / name).write_text("private sentinel")
            with patch("bot_setup.subagents.run") as run:
                configure_subagents(bot, root=ROOT)
                configure_subagents(bot, root=ROOT)
            updated = json.loads((private / "settings.json").read_text())
            self.assertEqual(updated["packages"], settings["packages"])
            self.assertEqual(updated["theme"], "custom")
            self.assertEqual(updated["extensions"][0], "./custom.ts")
            self.assertEqual(len(updated["extensions"]), 2)
            self.assertEqual(run.call_args.args, ("pnpm", "install", "--frozen-lockfile"))
            for name in ("auth.json", "subagents.json", "telegram.json"):
                self.assertEqual((private / name).read_text(), "private sentinel")
            self.assertTrue((private / "skills/use-subagent/SKILL.md").is_file())

    def test_owned_checkout_needs_no_settings_mutation(self):
        with patch("bot_setup.subagents.run") as run:
            configure_subagents(ROOT / "bots/tl-bot", root=ROOT)
        run.assert_not_called()

    def test_dependency_is_exact_and_tl_only(self):
        tl = json.loads((ROOT / "bots/tl-bot/package.json").read_text())
        pm = json.loads((ROOT / "bots/pm-bot/package.json").read_text())
        self.assertEqual(tl["dependencies"]["pi-subagents"], "0.81.0")
        self.assertNotIn("pi-subagents", pm["dependencies"])
