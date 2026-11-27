"""Installed setup commands do not depend on a root environment or cwd."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[4]


def test_help_and_refresh_from_unrelated_directory(tmp_path):
    home = tmp_path / "home"
    process_env = {**os.environ, "HOME": str(home)}
    for command in ([], ["configure"], ["refresh-telegram"], ["skills", "check"]):
        result = subprocess.run([sys.executable, "-m", "bot_setup.cli", *command, "--help"], cwd=tmp_path, env=process_env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    env = tmp_path / "private.env"
    env.write_text("COS_TELEGRAM_TOKEN=101:private-cos\nTELEGRAM_ALLOWED_USER_ID=123\n")
    profile = tmp_path / "bots/cos-bot"
    profile.mkdir(parents=True)
    shutil.copy2(ROOT / "bots/cos-bot/bot.toml", profile / "bot.toml")
    result = subprocess.run([sys.executable, "-m", "bot_setup.cli", "refresh-telegram", "--root", str(tmp_path), str(env)], cwd=tmp_path, env=process_env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    config = home / ".battuta/pi-bots/cos-bot/.pi/telegram.json"
    assert json.loads(config.read_text())["profiles"]["default"]["allowedUserId"] == 123
    assert config.stat().st_mode & 0o777 == 0o600
    assert "private-cos" not in result.stdout + result.stderr
    assert not (home / ".battuta/pi-bots/manager-bot/.pi/telegram.json").exists()
