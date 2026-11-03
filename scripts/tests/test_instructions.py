"""Personal guidance assembly preserves shared/role sources and local content."""

from itertools import product
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.instructions import configure_instructions  # noqa: E402
from skill_fixtures import skill_catalog  # noqa: E402


class InstructionTests(unittest.TestCase):
    def test_source_instructions_are_assembled_for_both_bots(self):
        root = Path(__file__).resolve().parents[2]

        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                bot = Path(directory) / f"{role}-bot"
                bot.mkdir()
                shutil.copyfile(root / "bots" / f"{role}-bot" / "AGENTS_dedicated.md", bot / "AGENTS_dedicated.md")

                configure_instructions(bot, role=role, root=root)

                instructions = (bot / "AGENTS.md").read_text()
                sources = [root / "bots/AGENTS_shared.md", bot / "AGENTS_dedicated.md"]
                self.assertEqual(instructions, "\n".join(source.read_text() for source in sources))

    def test_explicit_role_installs_into_custom_bot_directory(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "checkout"
                bot = Path(directory) / "custom assistant"
                bot.mkdir()
                (root / "bots").mkdir(parents=True)
                (root / "bots/AGENTS_shared.md").write_text("Shared")
                (bot / "AGENTS_dedicated.md").write_text("Dedicated")
                skill_catalog(root, role)
                configure_instructions(bot, role=role, root=root)
                self.assertEqual((bot / "AGENTS.md").read_text(), "Shared\nDedicated")
                self.assertEqual((bot / ".pi/skills/memory").resolve(), (root / "skills-hub/memory").resolve())
                self.assertTrue((bot / ".pi/skills/memory").is_symlink())
                self.assertEqual((bot / ".pi/skills/draft-writing/SKILL.md").is_file(), role == "pm")

    def test_legacy_personal_guidance_is_preserved_but_not_embedded(self):
        for role, personal in product(("pm-bot", "tl-bot"), (None, "Personal guidance")):
            with self.subTest(role=role, personal=personal), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = root / "bots" / role
                bot.mkdir(parents=True)
                shared = root / "bots/AGENTS_shared.md"
                shared.write_text("Shared instructions")
                (bot / "AGENTS_dedicated.md").write_text("Role instructions")
                skill_catalog(root, role.removesuffix("-bot"))
                memory = bot / ".pi/skills/memory"
                memory.mkdir(parents=True)
                (memory / "SKILL.md").write_text("Local memory")
                personal_path = root / "bots/AGENTS_personal.md"
                if personal is not None:
                    personal_path.write_text(personal)
                for _ in range(2):
                    configure_instructions(bot, role=role.removesuffix("-bot"))
                    expected = "Shared instructions\nRole instructions"
                    self.assertEqual((bot / "AGENTS.md").read_text(), expected)
                    self.assertTrue((bot / ".pi/skills/memory").is_dir())
                    self.assertEqual(shared.read_text(), "Shared instructions")
                    if personal is not None:
                        self.assertEqual(personal_path.read_text(), personal)
