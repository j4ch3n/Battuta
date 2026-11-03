"""Packaged configuration uses hub manifests without replacing local content."""

from itertools import product
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from skill_fixtures import skill_catalog

ROOT = Path(__file__).resolve().parents[2]


class SharedResourceTests(unittest.TestCase):
    def configure(self, root, bot):
        return subprocess.run([
            "node", "--input-type=module", "-e",
            "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3]);",
            str(ROOT / "packaging/shared-resources.mjs"), str(root), str(bot),
        ], capture_output=True, text=True)

    def prepare(self, root, role):
        skill_catalog(root, role)
        (root / "bots/AGENTS_shared.md").write_text("Shared")
        bot = root / f"bots/{role}-bot"
        (bot / "AGENTS_dedicated.md").write_text("Dedicated")
        return bot

    def test_manifest_selection_and_owned_link_migration_are_idempotent(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = self.prepare(root, role)
                (bot / "skills.json").write_text('{"skills":["project-context","note-taking"]}')
                link = bot / ".pi/skills/project-context"
                link.parent.mkdir(parents=True)
                link.symlink_to("../../../shared-skills/project-context")
                for _ in range(2):
                    result = self.configure(root, bot)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual({p.name for p in link.parent.iterdir()}, {"project-context", "note-taking"})
                    self.assertEqual(link.resolve(), (root / "skills-hub/project-context").resolve())
                    self.assertEqual((link / "references/tools.md").read_text(), "project-context tools")
                    self.assertEqual((bot / "AGENTS.md").read_text(), "Shared\nDedicated")

    def test_conflicts_and_missing_sources_leave_existing_output_unchanged(self):
        for role, kind in product(("pm", "tl"), ("file", "link", "missing")):
            with self.subTest(role=role, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = self.prepare(root, role)
                target = bot / ".pi/skills/note-taking"
                target.parent.mkdir(parents=True)
                if kind == "missing":
                    (root / "skills-hub/note-taking/SKILL.md").unlink()
                elif kind == "file":
                    target.write_text("custom")
                else:
                    target.symlink_to("custom-notes")
                result = self.configure(root, bot)
                self.assertNotEqual(result.returncode, 0)
                if kind == "file":
                    self.assertEqual(target.read_text(), "custom")
                elif kind == "link":
                    self.assertEqual(target.readlink(), Path("custom-notes"))
                else:
                    self.assertFalse(target.is_symlink())

    def test_bundled_and_custom_skill_content_is_preserved(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = self.prepare(root, role)
                for name in ("memory", "note-taking"):
                    target = bot / ".pi/skills" / name
                    target.mkdir(parents=True)
                    (target / "SKILL.md").write_text("custom")
                result = self.configure(root, bot)
                self.assertEqual(result.returncode, 0, result.stderr)
                for name in ("memory", "note-taking"):
                    self.assertEqual((bot / ".pi/skills" / name / "SKILL.md").read_text(), "custom")

    def test_stage_portability_and_resources_and_invalid_selection_preflight(self):
        for valid in (True, False):
            with self.subTest(valid=valid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "stage"
                for role in ("pm", "tl"):
                    skill_catalog(root, role)
                    skills = root / f"bots/{role}-bot/.pi/skills"
                    skills.mkdir(parents=True)
                    (skills / "memory").symlink_to("../../../../skills-hub/memory")
                if not valid:
                    (root / "bots/tl-bot/skills.json").write_text('{"skills":["missing"]}')
                result = subprocess.run(["node", str(ROOT / "packaging/stage-skills.mjs"), str(root)], capture_output=True, text=True)
                if not valid:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertTrue((root / "bots/pm-bot/.pi/skills/memory").is_symlink())
                    continue
                self.assertEqual(result.returncode, 0, result.stderr)
                moved = root.with_name("relocated")
                shutil.move(root, moved)
                for role in ("pm", "tl"):
                    bot = moved / f"bots/{role}-bot"
                    names = json.loads((bot / "skills.json").read_text())["skills"]
                    for name in names:
                        skill = bot / ".pi/skills" / name
                        self.assertTrue((skill / "SKILL.md").is_file())
                        self.assertEqual((skill / "references/tools.md").read_text(), f"{name} tools")
                    self.assertFalse((bot / ".pi/skills/memory").is_symlink())
                    self.assertTrue((bot / ".pi/skills/project-context").is_symlink())
