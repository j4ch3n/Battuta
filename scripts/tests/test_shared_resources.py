"""Release configuration keeps memory local without overwriting custom skills."""

from pathlib import Path
from itertools import product
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SharedResourceTests(unittest.TestCase):
    def test_custom_memory_skills_survive_release_configuration(self):
        for role, kind in product(("pm", "tl"), ("directory", "symlink", "file")):
            with self.subTest(role=role, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                helper = root / "shared-resources.mjs"
                shutil.copyfile(ROOT / "packaging/shared-resources.mjs", helper)
                bot = root / f"bots/custom-{role}"
                link = bot / ".pi/skills/memory"
                link.parent.mkdir(parents=True)
                (root / "shared-skills/project-context").mkdir(parents=True)
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
                (root / "shared-skills/project-context").mkdir(parents=True)
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
