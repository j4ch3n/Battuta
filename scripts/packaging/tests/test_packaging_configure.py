"""Fresh release configuration validates catalog metadata before writes."""

import json
from unittest.mock import patch

import click
import pytest

from bot_setup.configure import configure_release
from skill_fixtures import skill_catalog


@pytest.fixture
def release(tmp_path, monkeypatch):
    for role in ("cos", "manager"):
        skill_catalog(tmp_path, role)
        bot = tmp_path / f"bots/{role}-bot"
        (bot / "AGENTS_dedicated.md").write_text(role)
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    values = {"LINEAR_API_TOKEN": "private-linear", "SUPABASE_URL": "http://localhost", "SUPABASE_SECRET_KEY": "private-supabase", "COS_TELEGRAM_TOKEN": "101:private-cos", "TELEGRAM_ALLOWED_USER_ID": "123", "BATTUTA_MEMORY_URL": "http://127.0.0.1:8901/mcp"}
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    return tmp_path


def test_invalid_second_manifest_prevents_release_writes(release):
    (release / "bots/manager-bot/skills.json").write_text('{"skills":["missing"]}')
    with patch("bot_setup.configure.run") as run:
        with pytest.raises(click.ClickException):
            configure_release(release)
    run.assert_not_called()
    for role in ("cos", "manager"):
        bot = release / f"bots/{role}-bot"
        assert not (bot / "AGENTS.md").exists()
        assert not (bot / ".pi").exists()


def test_release_setup_is_repeatable_without_skill_output(release, capsys):
    with patch("bot_setup.configure.run"):
        configure_release(release)
        for role in ("cos", "manager"):
            pi = release / f"bots/{role}-bot/.pi"
            (pi / "mcp-auth.json").write_bytes(b'{"private":"oauth"}\n')
            settings = json.loads((pi / "settings.json").read_text())
            settings["theme"] = "custom"
            (pi / "settings.json").write_text(json.dumps(settings))
        configure_release(release)
    for role in ("cos", "manager"):
        pi = release / f"bots/{role}-bot/.pi"
        assert not (pi / "skills").exists()
        assert (pi / "telegram.json").exists() == (role == "cos")
        assert (pi / "mcp-auth.json").read_bytes() == b'{"private":"oauth"}\n'
        settings = json.loads((pi / "settings.json").read_text())
        assert settings["theme"] == "custom"
        assert settings["battutaMemoryCapture"]["enabled"] == (role == "cos")
        servers = json.loads((pi / "mcp.json").read_text())["mcpServers"]
        assert ("luma" in servers) == (role == "cos")
        assert (pi / "settings.json").stat().st_mode & 0o777 == 0o600
    output = capsys.readouterr()
    assert "private-" not in output.out + output.err


@pytest.mark.parametrize("field", ["TELEGRAM_ALLOWED_USER_ID", "COS_TELEGRAM_TOKEN"])
def test_unsafe_telegram_id_prevents_any_writes(release, monkeypatch, field):
    monkeypatch.setenv(field, "9007199254740993" if field == "TELEGRAM_ALLOWED_USER_ID" else "9007199254740993:private-token")
    with patch("bot_setup.configure.run") as run:
        with pytest.raises(click.ClickException):
            configure_release(release)
    run.assert_not_called()
    assert not any((release / f"bots/{role}-bot/.pi").exists() for role in ("cos", "manager"))
