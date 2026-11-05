"""Telegram configuration helper validation, preservation, and idempotence."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys
import pytest
import click

from fixtures import ConfigFixture

from bot_setup.telegram import configure_telegram, prepare_telegram_config  # noqa: E402


@pytest.mark.parametrize("field", ["owner", "bot"])
@pytest.mark.parametrize("value", [9007199254740991, 9007199254740992, 9007199254740993])
def test_telegram_ids_must_be_exactly_representable_in_javascript(tmp_path, field, value):
    values = {"COS_TELEGRAM_TOKEN": "101:private-token", "TELEGRAM_ALLOWED_USER_ID": "123"}
    if field == "owner":
        values["TELEGRAM_ALLOWED_USER_ID"] = str(value)
    else:
        values["COS_TELEGRAM_TOKEN"] = f"{value}:private-token"
    if value == 9007199254740991:
        _, config, _ = prepare_telegram_config(tmp_path, tmp_path / "private.env", "COS", values)
        key = "allowedUserId" if field == "owner" else "botId"
        assert config["profiles"]["default"][key] == value
    else:
        with pytest.raises(click.ClickException):
            configure_telegram(tmp_path, tmp_path / "private.env", "COS", values)
        assert not (tmp_path / ".pi").exists()


class TelegramConfigTests(ConfigFixture):
    def values(self):
        return {"COS_TELEGRAM_TOKEN": "101:new-token", "TELEGRAM_ALLOWED_USER_ID": "123",
                "COS_TELEGRAM_BOT_USERNAME": "@new_cos_bot"}

    def test_preparation_derives_ids_without_writing_and_preserves_unrelated_settings(self):
        before = self.config_path("cos").read_text()
        config, data, changed = prepare_telegram_config(self.root / "bots/cos-bot", self.root / ".env", "COS", self.values())
        self.assertTrue(changed)
        self.assertEqual(config, self.config_path("cos"))
        self.assertEqual(data["profiles"]["default"], {
            "botToken": "101:new-token", "botId": 101, "allowedUserId": 123,
            "botUsername": "new_cos_bot", "customSetting": True,
        })
        self.assertEqual(data["profiles"]["other"], {"preserve": True})
        self.assertTrue(data["custom"])
        self.assertEqual(self.config_path("cos").read_text(), before)

    def test_configuration_is_private_and_idempotent_and_removes_omitted_username(self):
        values = self.values()
        values.pop("COS_TELEGRAM_BOT_USERNAME")
        with redirect_stdout(StringIO()):
            configure_telegram(self.root / "bots/cos-bot", self.root / ".env", "COS", values)
        self.assertNotIn("botUsername", self.config("cos")["profiles"]["default"])
        self.assertEqual(self.config_path("cos").stat().st_mode & 0o777, 0o600)
        before = self.config_path("cos").stat().st_mtime_ns
        with redirect_stdout(StringIO()):
            configure_telegram(self.root / "bots/cos-bot", self.root / ".env", "COS", values)
        self.assertEqual(self.config_path("cos").stat().st_mtime_ns, before)
