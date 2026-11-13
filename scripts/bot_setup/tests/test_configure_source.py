"""Clean source configuration installs Telegram for CoS only."""

import json
from pathlib import Path
from unittest.mock import patch

import click
import pytest

from bot_setup.configure import configure_source
from skill_fixtures import skill_catalog


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))


@pytest.mark.parametrize("role", ["cos", "manager"])
def test_source_configuration_has_role_appropriate_packages(tmp_path, role):
    names = skill_catalog(
        tmp_path,
        role,
        json.loads((Path(__file__).parents[3] / "bots/manager-bot/skills.json").read_text())["skills"]
        if role == "manager"
        else None,
    )
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
    assert not any("pi-subagents" in source for source in sources)
    assert any("pi-scheduler" in source for source in sources) == (role == "cos")
    if role == "cos":
        assert runtime.call_args_list[0].args[:2] == ("pnpm", "--dir")
        dream = runtime.call_args_list[1]
        assert dream.args == ("node", str(tmp_path / "memory-client/configure-dream.mjs"), str(bot))
        assert dream.kwargs["env"]["PI_CODING_AGENT_DIR"] == str(tmp_path / "home/.battuta/pi-bots/cos-bot/.pi")
    else:
        runtime.assert_not_called()
    pi = bot / ".pi"
    runtime_pi = tmp_path / f"home/.battuta/pi-bots/{role}-bot/.pi"
    assert (runtime_pi / "telegram.json").exists() == (role == "cos")
    assert all((pi / "skills" / name).is_symlink() for name in names)
    assert json.loads((pi / "settings.json").read_text())["battutaMemoryCapture"]["enabled"] == (role == "cos")
    if role == "cos":
        browser = json.loads((runtime_pi / "settings.json").read_text()).get("pi-browser-use")
        assert browser["userDataDir"] == str(tmp_path / "home/.battuta/pi-bots/cos-bot/.pi/browser-research")
        project_browser = json.loads((pi / "settings.json").read_text())["pi-browser-use"]
        assert "executablePath" not in project_browser
        assert "userDataDir" not in project_browser
    else:
        assert "pi-browser-use" not in json.loads((pi / "settings.json").read_text())
    servers = json.loads((runtime_pi / "mcp.json").read_text())["mcpServers"]
    assert "assignments" in servers
    assert servers["memory"]["enabled"] is (role == "manager")
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
