"""Telegram configuration helper validation, preservation, and idempotence."""

import json

import click
import pytest

from bot_setup.telegram import configure_telegram, prepare_telegram_config


@pytest.mark.parametrize("field", ["owner", "bot"])
@pytest.mark.parametrize("value", [9007199254740991, 9007199254740992, 9007199254740993], ids=["max-safe", "max-safe+1", "max-safe+2"])
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


@pytest.fixture
def cos_dir(tmp_path):
    """A CoS bot directory whose Telegram config already holds unrelated settings."""
    bot = tmp_path / "cos-bot"
    config = bot / ".pi/telegram.json"
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({
        "profiles": {"default": {
            "botToken": "9:old", "botId": 9, "allowedUserId": 9,
            "botUsername": "old_bot", "customSetting": True,
        }, "other": {"preserve": True}}, "custom": True,
    }))
    return bot


def telegram_values():
    return {"COS_TELEGRAM_TOKEN": "101:new-token", "TELEGRAM_ALLOWED_USER_ID": "123",
            "COS_TELEGRAM_BOT_USERNAME": "@new_cos_bot"}


def test_preparation_derives_ids_without_writing_and_preserves_unrelated_settings(cos_dir, tmp_path):
    path = cos_dir / ".pi/telegram.json"
    before = path.read_text()
    config, data, changed = prepare_telegram_config(cos_dir, tmp_path / ".env", "COS", telegram_values())
    assert changed
    assert config == path
    assert data["profiles"]["default"] == {
        "botToken": "101:new-token", "botId": 101, "allowedUserId": 123,
        "botUsername": "new_cos_bot", "customSetting": True,
    }
    assert data["profiles"]["other"] == {"preserve": True}
    assert data["custom"]
    assert path.read_text() == before


def test_configuration_is_private_and_idempotent_and_removes_omitted_username(cos_dir, tmp_path, capsys):
    path = cos_dir / ".pi/telegram.json"
    values = telegram_values()
    values.pop("COS_TELEGRAM_BOT_USERNAME")
    configure_telegram(cos_dir, tmp_path / ".env", "COS", values)
    assert "botUsername" not in json.loads(path.read_text())["profiles"]["default"]
    assert path.stat().st_mode & 0o777 == 0o600
    before = path.stat().st_mtime_ns
    configure_telegram(cos_dir, tmp_path / ".env", "COS", values)
    assert path.stat().st_mtime_ns == before
