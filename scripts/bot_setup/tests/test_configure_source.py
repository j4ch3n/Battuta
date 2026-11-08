"""Clean source configuration installs Telegram for CoS only."""

import json
from unittest.mock import patch

import click
import pytest

from bot_setup.configure import configure_source
from skill_fixtures import skill_catalog


@pytest.mark.parametrize("role", ["cos", "manager"])
def test_source_configuration_has_role_appropriate_packages(tmp_path, role):
    names = skill_catalog(tmp_path, role)
    bot = tmp_path / f"bots/{role}-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (bot / "package.json").write_text("{}")
    env = tmp_path / ".env"
    env.write_text("LINEAR_API_TOKEN=private-linear\nSUPABASE_URL=http://localhost:54321\nSUPABASE_SECRET_KEY=private-supabase\n" + ("COS_TELEGRAM_TOKEN=101:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n" if role == "cos" else ""))
    with patch("bot_setup.configure.run") as runtime, patch("bot_setup.install.run") as install:
        for _ in range(2):
            configure_source(tmp_path, role=role)
    sources = [call.args[-1] for call in install.call_args_list if "install" in call.args and "-l" in call.args]
    assert any("pi-telegram" in source for source in sources) == (role == "cos")
    assert any("pi-subagents" in source for source in sources) == (role == "manager")
    assert any("pi-scheduler" in source for source in sources) == (role == "cos")
    if role == "cos":
        assert runtime.call_args_list[0].args[:2] == ("pnpm", "--dir")
        assert runtime.call_args_list[1].args == ("node", str(tmp_path / "memory-client/configure-scheduler.mjs"), "--initialize")
    else:
        runtime.assert_not_called()
    pi = bot / ".pi"
    assert (pi / "telegram.json").exists() == (role == "cos")
    assert all((pi / "skills" / name).is_symlink() for name in names)
    assert json.loads((pi / "settings.json").read_text())["battutaMemoryCapture"]["enabled"] == (role == "cos")
    assert "assignments" in json.loads((pi / "mcp.json").read_text())["mcpServers"]
    assert not (tmp_path / "bots/worker/.pi/mcp.json").exists()


@pytest.mark.parametrize("role", ["cos", "manager"])
def test_other_bot_setup_preserves_prepared_worker_tool_restrictions(tmp_path, role):
    from bot_setup.mcp import configure_mcp

    skill_catalog(tmp_path, role)
    bot = tmp_path / f"bots/{role}-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (bot / "package.json").write_text("{}")
    (tmp_path / ".env").write_text("LINEAR_API_TOKEN=private-linear\nSUPABASE_URL=http://localhost:54321\nSUPABASE_SECRET_KEY=private-supabase\nCOS_TELEGRAM_TOKEN=101:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n")
    worker = tmp_path / "bots/worker"
    configure_mcp(worker, role="worker", supabase_url="http://localhost:54321")
    before = (worker / ".pi/mcp.json").read_bytes()
    with patch("bot_setup.configure.run"), patch("bot_setup.install.run"):
        configure_source(tmp_path, role=role)
    assert (worker / ".pi/mcp.json").read_bytes() == before


@pytest.mark.parametrize("values", ["", "COS_TELEGRAM_TOKEN=101:private-token\n", "COS_TELEGRAM_TOKEN=9007199254740993:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n"])
def test_invalid_cos_input_has_no_configuration_writes(tmp_path, values):
    skill_catalog(tmp_path, "cos")
    bot = tmp_path / "bots/cos-bot"
    (bot / "package.json").write_text("{}")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (tmp_path / ".env").write_text("LINEAR_API_TOKEN=private-linear\nSUPABASE_URL=http://localhost:54321\nSUPABASE_SECRET_KEY=private-supabase\n" + values)
    with patch("bot_setup.configure.run") as run, pytest.raises(click.ClickException):
        configure_source(tmp_path, role="cos")
    run.assert_not_called()
    assert not (bot / "AGENTS.md").exists()
    assert not (bot / ".pi").exists()


@pytest.mark.parametrize("missing", ["SUPABASE_URL", "SUPABASE_SECRET_KEY"])
def test_missing_assignment_credentials_prevents_source_writes(tmp_path, missing):
    skill_catalog(tmp_path, "manager")
    bot = tmp_path / "bots/manager-bot"
    (bot / "package.json").write_text("{}")
    values = {"LINEAR_API_TOKEN": "private-linear", "SUPABASE_URL": "https://example.com", "SUPABASE_SECRET_KEY": "private-supabase"}
    values.pop(missing)
    (tmp_path / ".env").write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    with pytest.raises(click.ClickException) as error:
        configure_source(tmp_path, role="manager")
    assert "private-" not in str(error.value)
    assert not (bot / ".pi").exists()


@pytest.mark.parametrize("url", ["https://exa mple.com", "https://example.com\\path", "https://bad_host.example"])
def test_bad_assignment_origin_prevents_source_writes(tmp_path, url):
    skill_catalog(tmp_path, "manager")
    bot = tmp_path / "bots/manager-bot"
    (bot / "package.json").write_text("{}")
    (tmp_path / ".env").write_text(f"LINEAR_API_TOKEN=private-linear\nSUPABASE_URL='{url}'\nSUPABASE_SECRET_KEY=private-supabase\n")
    with pytest.raises(click.ClickException, match="SUPABASE_URL") as error:
        configure_source(tmp_path, role="manager")
    assert "private-" not in str(error.value)
    assert not (bot / ".pi").exists()
