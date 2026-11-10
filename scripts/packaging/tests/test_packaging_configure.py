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
            if role == "manager":
                (release / "skills-hub/custom-memory").mkdir()
                settings["skills"] = ["../custom-skill", "../../../skills-hub/custom-memory", *settings.get("skills", [])]
            (pi / "settings.json").write_text(json.dumps(settings))
        (release / "bots/manager-bot/skills.json").write_text('{"skills":["todo"]}')
        configure_release(release)
    for role in ("cos", "manager"):
        pi = release / f"bots/{role}-bot/.pi"
        assert not (pi / "skills").exists()
        assert (pi / "telegram.json").exists() == (role == "cos")
        assert (pi / "mcp-auth.json").read_bytes() == b'{"private":"oauth"}\n'
        settings = json.loads((pi / "settings.json").read_text())
        assert settings["theme"] == "custom"
        assert settings["battutaMemoryCapture"]["enabled"] == (role == "cos")
        if role == "manager":
            names = json.loads((release / "bots/manager-bot/skills.json").read_text())["skills"]
            assert settings["skills"][:2] == ["../custom-skill", "../../../skills-hub/custom-memory"]
            assert [(pi / path).resolve() for path in settings["skills"][2:]] == [
                release / "skills-hub" / name for name in names
            ]
            assert settings["battutaManagerResources"] == {"skills": settings["skills"][2:]}
        else:
            assert "skills" not in settings
        servers = json.loads((pi / "mcp.json").read_text())["mcpServers"]
        assert ("luma" in servers) == (role == "cos")
        assert servers["memory"]["enabled"] is (role == "manager")
        assert servers["assignments"]["headers"] == {"apikey": "${SUPABASE_SECRET_KEY}"}
        assert (pi / "settings.json").stat().st_mode & 0o777 == 0o600
    output = capsys.readouterr()
    assert "private-" not in output.out + output.err


def test_release_setup_preserves_legacy_skill_settings(release):
    with patch("bot_setup.configure.run"):
        configure_release(release)
        settings_path = release / "bots/manager-bot/.pi/settings.json"
        settings = json.loads(settings_path.read_text())
        settings["skills"] = {"customDirectories": ["../custom-skill"], "enableSkillCommands": False}
        settings_path.write_text(json.dumps(settings))
        configure_release(release)
    settings = json.loads(settings_path.read_text())
    assert settings["skills"]["enableSkillCommands"] is False
    assert settings["skills"]["customDirectories"][0] == "../custom-skill"
    assert [(settings_path.parent / path).resolve() for path in settings["skills"]["customDirectories"][1:]] == [
        release / "skills-hub" / name
        for name in json.loads((release / "bots/manager-bot/skills.json").read_text())["skills"]
    ]


def test_release_setup_preserves_worker_tool_restrictions(release):
    from bot_setup.mcp import configure_mcp

    worker = release / "bots/worker"
    configure_mcp(worker, role="worker", supabase_url="http://localhost")
    before = (worker / ".pi/mcp.json").read_bytes()
    with patch("bot_setup.configure.run"):
        configure_release(release)
    assert (worker / ".pi/mcp.json").read_bytes() == before


@pytest.mark.parametrize("field", ["TELEGRAM_ALLOWED_USER_ID", "COS_TELEGRAM_TOKEN"])
def test_unsafe_telegram_id_prevents_any_writes(release, monkeypatch, field):
    monkeypatch.setenv(field, "9007199254740993" if field == "TELEGRAM_ALLOWED_USER_ID" else "9007199254740993:private-token")
    with patch("bot_setup.configure.run") as run:
        with pytest.raises(click.ClickException):
            configure_release(release)
    run.assert_not_called()
    assert not any((release / f"bots/{role}-bot/.pi").exists() for role in ("cos", "manager"))


@pytest.mark.parametrize("value", ["http://remote.example.com", "https://user:private-password@example.com", "https://exa mple.com", "https://example.com\\path", "https://example.com/\n", "https://bad_host.example"])
def test_bad_assignment_url_prevents_release_writes(release, monkeypatch, value):
    monkeypatch.setenv("SUPABASE_URL", value)
    with patch("bot_setup.configure.run"), pytest.raises(click.ClickException, match="SUPABASE_URL") as error:
        configure_release(release)
    assert "private-password" not in str(error.value)
    assert not any((release / f"bots/{role}-bot/.pi").exists() for role in ("cos", "manager"))
