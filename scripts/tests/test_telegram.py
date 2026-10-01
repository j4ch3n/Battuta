"""Telegram configuration helper validation, preservation, and idempotence."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys

from fixtures import ConfigFixture

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.telegram import configure_telegram, prepare_telegram_config  # noqa: E402


class TelegramConfigTests(ConfigFixture):
    def values(self):
        return {"PM_TELEGRAM_TOKEN": "101:new-token", "TELEGRAM_ALLOWED_USER_ID": "123",
                "PM_TELEGRAM_BOT_USERNAME": "@new_pm_bot"}

    def test_preparation_derives_ids_without_writing_and_preserves_unrelated_settings(self):
        before = self.config_path("pm").read_text()
        config, data, changed = prepare_telegram_config(self.root / "bots/pm-bot", self.root / ".env", "PM", self.values())
        self.assertTrue(changed)
        self.assertEqual(config, self.config_path("pm"))
        self.assertEqual(data["profiles"]["default"], {
            "botToken": "101:new-token", "botId": 101, "allowedUserId": 123,
            "botUsername": "new_pm_bot", "customSetting": True,
        })
        self.assertEqual(data["profiles"]["other"], {"preserve": True})
        self.assertTrue(data["custom"])
        self.assertEqual(self.config_path("pm").read_text(), before)

    def test_configuration_is_private_and_idempotent_and_removes_omitted_username(self):
        values = self.values()
        values.pop("PM_TELEGRAM_BOT_USERNAME")
        with redirect_stdout(StringIO()):
            configure_telegram(self.root / "bots/pm-bot", self.root / ".env", "PM", values)
        self.assertNotIn("botUsername", self.config("pm")["profiles"]["default"])
        self.assertEqual(self.config_path("pm").stat().st_mode & 0o777, 0o600)
        before = self.config_path("pm").stat().st_mtime_ns
        with redirect_stdout(StringIO()):
            configure_telegram(self.root / "bots/pm-bot", self.root / ".env", "PM", values)
        self.assertEqual(self.config_path("pm").stat().st_mtime_ns, before)
