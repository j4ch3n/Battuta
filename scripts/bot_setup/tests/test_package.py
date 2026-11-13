"""Installed setup commands do not depend on a root environment or cwd."""

import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class PackageTests(unittest.TestCase):
    def test_help_and_refresh_from_unrelated_directory(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory).resolve()
            home = root / "home"
            process_env = {**os.environ, "HOME": str(home)}
            for command in ([], ["configure"], ["refresh-telegram"], ["skills", "check"]):
                result = subprocess.run([sys.executable, "-m", "bot_setup.cli", *command, "--help"], cwd=root, env=process_env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            env = root / "private.env"
            env.write_text("COS_TELEGRAM_TOKEN=101:private-cos\nTELEGRAM_ALLOWED_USER_ID=123\n")
            profile = root / "bots/cos-bot"
            profile.mkdir(parents=True)
            shutil.copy2(Path(__file__).parents[3] / "bots/cos-bot/bot.toml", profile / "bot.toml")
            result = subprocess.run([sys.executable, "-m", "bot_setup.cli", "refresh-telegram", "--root", str(root), str(env)], cwd="/tmp", env=process_env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for role in ("cos",):
                config = home / f".battuta/pi-bots/{role}-bot/.pi/telegram.json"
                self.assertEqual(json.loads(config.read_text())["profiles"]["default"]["allowedUserId"], 123)
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("private-cos", result.stdout + result.stderr)
            self.assertFalse((home / ".battuta/pi-bots/manager-bot/.pi/telegram.json").exists())
