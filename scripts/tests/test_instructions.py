"""Personal guidance assembly preserves shared/role sources and local content."""

from itertools import product
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.instructions import configure_instructions  # noqa: E402


class InstructionTests(unittest.TestCase):
    def test_optional_personal_guidance_is_appended_for_both_bots(self):
        for role, personal in product(("pm-bot", "tl-bot"), (None, "Personal guidance")):
            with self.subTest(role=role, personal=personal), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = root / "bots" / role
                bot.mkdir(parents=True)
                shared = root / "bots/AGENTS_shared.md"
                shared.write_text("Shared instructions")
                (bot / "AGENTS_dedicated.md").write_text("Role instructions")
                for name in ("project-context", "memory"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                personal_path = root / "bots/AGENTS_personal.md"
                if personal is not None:
                    personal_path.write_text(personal)
                for _ in range(2):
                    configure_instructions(bot)
                    expected = "Shared instructions\nRole instructions" + (f"\n{personal}" if personal else "")
                    self.assertEqual((bot / "AGENTS.md").read_text(), expected)
                    self.assertTrue((bot / ".pi/skills/memory").is_dir())
                    self.assertEqual(shared.read_text(), "Shared instructions")
                    if personal is not None:
                        self.assertEqual(personal_path.read_text(), personal)
