"""Release configuration keeps memory local without overwriting custom skills."""

from pathlib import Path
from itertools import product
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SharedResourceTests(unittest.TestCase):
    def test_release_removes_only_owned_shared_draft_links(self):
        for role, existing in product(("pm", "tl"), ("owned", "custom")):
            with self.subTest(role=role, existing=existing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = root / f"bots/{role}-bot"
                draft = bot / ".pi/skills/draft-writing"
                draft.parent.mkdir(parents=True)
                if existing == "owned":
                    draft.symlink_to("../../../../shared-skills/draft-writing")
                else:
                    draft.mkdir()
                    (draft / "SKILL.md").write_text("Custom")
                for name in ("project-context", "todo", "note-taking"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                (root / "bots/AGENTS_shared.md").write_text("Shared")
                (bot / "AGENTS_dedicated.md").write_text("Dedicated")
                result = subprocess.run([
                    "node", "--input-type=module", "-e",
                    "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3]);",
                    str(ROOT / "packaging/shared-resources.mjs"), str(root), str(bot),
                ], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(draft.is_symlink())
                self.assertEqual(draft.exists(), existing == "custom")
                if existing == "custom":
                    self.assertEqual((draft / "SKILL.md").read_text(), "Custom")

    def test_release_working_skill_conflicts_and_missing_sources_fail_safely(self):
        for role, name, kind in product(("pm", "tl"), ("todo", "note-taking"), ("directory", "file", "symlink", "missing")):
            with self.subTest(role=role, name=name, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = root / f"bots/{role}-bot"
                target = bot / ".pi/skills" / name
                target.parent.mkdir(parents=True)
                (root / "bots/AGENTS_shared.md").write_text("Shared")
                (bot / "AGENTS_dedicated.md").write_text("Dedicated")
                for skill in ("project-context", "todo", "note-taking"):
                    if kind != "missing" or skill != name:
                        (root / "shared-skills" / skill).mkdir(parents=True)
                if kind == "directory":
                    target.mkdir()
                    (target / "SKILL.md").write_text("Custom")
                elif kind == "file":
                    target.write_text("Custom")
                elif kind == "symlink":
                    target.symlink_to("custom-skill")
                result = subprocess.run([
                    "node", "--input-type=module", "-e",
                    "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3]);",
                    str(ROOT / "packaging/shared-resources.mjs"), str(root), str(bot),
                ], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                if kind == "directory":
                    self.assertEqual((target / "SKILL.md").read_text(), "Custom")
                elif kind == "file":
                    self.assertEqual(target.read_text(), "Custom")
                elif kind == "symlink":
                    self.assertEqual(target.readlink(), Path("custom-skill"))
                else:
                    self.assertFalse(target.is_symlink())

    def test_release_working_skills_are_discoverable_and_idempotent(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = root / f"bots/{role}-bot"
                bot.mkdir(parents=True)
                (root / "bots/AGENTS_shared.md").write_text("Shared")
                (bot / "AGENTS_dedicated.md").write_text("Dedicated")
                for name in ("project-context", "todo", "note-taking"):
                    source = root / "shared-skills" / name
                    (source / "references").mkdir(parents=True)
                    (source / "SKILL.md").write_text(name)
                    (source / "references/commands.md").write_text(f"{name} commands")
                for _ in range(2):
                    result = subprocess.run([
                        "node", "--input-type=module", "-e",
                        "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3]);",
                        str(ROOT / "packaging/shared-resources.mjs"), str(root), str(bot),
                    ], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    for name in ("project-context", "todo", "note-taking"):
                        link = bot / ".pi/skills" / name
                        self.assertEqual(link.resolve(), (root / "shared-skills" / name).resolve())
                        self.assertEqual((link / "references/commands.md").read_text(), f"{name} commands")

    def test_custom_memory_skills_survive_release_configuration(self):
        for role, kind in product(("pm", "tl"), ("directory", "symlink", "file")):
            with self.subTest(role=role, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                helper = root / "shared-resources.mjs"
                shutil.copyfile(ROOT / "packaging/shared-resources.mjs", helper)
                bot = root / f"bots/custom-{role}"
                link = bot / ".pi/skills/memory"
                link.parent.mkdir(parents=True)
                for name in ("project-context", "todo", "note-taking"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                (root / "bots/AGENTS_shared.md").write_text("Shared")
                (bot / "AGENTS_dedicated.md").write_text("Dedicated")
                source = root / f"bots/{role}-bot/.pi/skills/memory"
                source.mkdir(parents=True)
                (source / "SKILL.md").write_text(f"{role} memory")
                if kind == "directory":
                    link.mkdir()
                    (link / "SKILL.md").write_text("Custom memory")
                elif kind == "symlink":
                    link.symlink_to("custom-memory")
                else:
                    link.write_text("Custom memory")
                result = subprocess.run([
                    "node", "--input-type=module", "-e",
                    "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3], process.argv[4]);",
                    str(helper), str(root), str(bot), role,
                ], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                if kind == "directory":
                    self.assertEqual((link / "SKILL.md").read_text(), "Custom memory")
                elif kind == "symlink":
                    self.assertEqual(link.readlink(), Path("custom-memory"))
                else:
                    self.assertEqual(link.read_text(), "Custom memory")

    def test_release_configuration_does_not_install_memory_skills(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                helper = root / "shared-resources.mjs"
                shutil.copyfile(ROOT / "packaging/shared-resources.mjs", helper)
                for name in ("project-context", "todo", "note-taking"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                source = root / f"bots/{role}-bot/.pi/skills/memory"
                (source / "references").mkdir(parents=True)
                (source / "SKILL.md").write_text(f"{role} memory")
                (source / "references/tools.md").write_text(f"{role} tools")
                (root / "bots/AGENTS_shared.md").write_text("Shared")
                bot = root / "bots/custom"
                link = bot / ".pi/skills/memory"
                link.parent.mkdir(parents=True)
                (bot / "AGENTS_dedicated.md").write_text("Dedicated")
                for _ in range(2):
                    result = subprocess.run([
                        "node", "--input-type=module", "-e",
                        "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3], process.argv[4]);",
                        str(helper), str(root), str(bot), role,
                    ], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertFalse(link.exists())
