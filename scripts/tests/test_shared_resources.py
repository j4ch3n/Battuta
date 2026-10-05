"""Release resource assembly refuses to overwrite custom memory skills."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SharedResourceTests(unittest.TestCase):
    def test_custom_memory_skills_survive_release_configuration(self):
        for kind in ("directory", "symlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                helper = root / "shared-resources.mjs"
                shutil.copyfile(ROOT / "packaging/shared-resources.mjs", helper)
                bot = root / "bots/pm-bot"
                link = bot / ".pi/skills/memory"
                link.parent.mkdir(parents=True)
                for name in ("project-context", "memory"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                if kind == "directory":
                    link.mkdir()
                    (link / "SKILL.md").write_text("Custom memory")
                else:
                    link.symlink_to("custom-memory")
                result = subprocess.run([
                    "node", "--input-type=module", "-e",
                    "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3]);",
                    str(helper), str(root), str(bot),
                ], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Refusing to replace existing skill", result.stderr)
                if kind == "directory":
                    self.assertEqual((link / "SKILL.md").read_text(), "Custom memory")
                else:
                    self.assertEqual(link.readlink(), Path("custom-memory"))
