"""Installed setup commands do not depend on a root environment or cwd."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class PackageTests(unittest.TestCase):
    def test_help_and_refresh_from_unrelated_directory(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory)
            for command in ([], ["configure"], ["refresh-telegram"], ["skills", "check"]):
                result = subprocess.run([sys.executable, "-m", "bot_setup.cli", *command, "--help"], cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            env = root / "private.env"
            env.write_text("COS_TELEGRAM_TOKEN=101:private-cos\nTELEGRAM_ALLOWED_USER_ID=123\n")
            result = subprocess.run([sys.executable, "-m", "bot_setup.cli", "refresh-telegram", "--root", str(root), str(env)], cwd="/tmp", capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for role in ("cos",):
                config = root / f"bots/{role}-bot/.pi/telegram.json"
                self.assertEqual(json.loads(config.read_text())["profiles"]["default"]["allowedUserId"], 123)
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("private-cos", result.stdout + result.stderr)
            self.assertFalse((root / "bots/manager-bot/.pi/telegram.json").exists())
