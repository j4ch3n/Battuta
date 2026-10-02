"""Release configuration installs shared skills from the archive root."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class PackagingConfigureTests(unittest.TestCase):
    def test_install_and_migrate_links_for_both_bots(self):
        for existing in (None, "../../../shared-skills/project-context"):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "bin").mkdir()
                shutil.copyfile(ROOT / "packaging" / "configure.mjs", root / "bin" / "configure.mjs")
                source = root / "shared-skills" / "project-context"
                source.mkdir(parents=True)
                (source / "SKILL.md").write_text("Shared project context")
                (root / "bots").mkdir()
                (root / "bots" / "AGENTS_shared.md").write_text("Shared instructions")
                for role in ("pm-bot", "tl-bot"):
                    bot = root / "bots" / role
                    skills = bot / ".pi" / "skills"
                    skills.mkdir(parents=True)
                    (bot / "AGENTS_dedicated.md").write_text(role)
                    if existing:
                        (skills / "project-context").symlink_to(existing, target_is_directory=True)
                env = {
                    **os.environ,
                    "TELEGRAM_ALLOWED_USER_ID": "123",
                    "LINEAR_API_KEY": "test-linear",
                    "SUPABASE_URL": "https://example.com",
                    "SUPABASE_SECRET_KEY": "test-supabase",
                    "PM_TELEGRAM_TOKEN": "456:test-pm",
                    "TL_TELEGRAM_TOKEN": "789:test-tl",
                }
                for _ in range(2):
                    result = subprocess.run(
                        ["node", str(root / "bin" / "configure.mjs")],
                        env=env, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    for role in ("pm-bot", "tl-bot"):
                        link = root / "bots" / role / ".pi" / "skills" / "project-context"
                        self.assertEqual((link / "SKILL.md").read_text(), "Shared project context")
                        self.assertEqual(link.resolve(), source.resolve())
                        self.assertFalse(link.readlink().is_absolute())
