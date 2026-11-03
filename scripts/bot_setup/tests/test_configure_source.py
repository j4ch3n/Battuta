"""Clean source configuration installs Telegram for CoS only."""

import json
from unittest.mock import patch

import click
import pytest

from bot_setup.configure import configure_source
from skill_fixtures import skill_catalog


@pytest.mark.parametrize("role", ["cos", "manager"])
def test_source_configuration_has_role_appropriate_packages(tmp_path, role):
    skill_catalog(tmp_path, role)
    bot = tmp_path / f"bots/{role}-bot"
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (bot / "package.json").write_text("{}")
    env = tmp_path / ".env"
    env.write_text("LINEAR_API_TOKEN=private-linear\n" + ("COS_TELEGRAM_TOKEN=101:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n" if role == "cos" else ""))
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
    assert (pi / "skills/memory").is_symlink()
    assert json.loads((pi / "settings.json").read_text())["battutaMemoryCapture"]["enabled"] == (role == "cos")


@pytest.mark.parametrize("values", ["", "COS_TELEGRAM_TOKEN=101:private-token\n", "COS_TELEGRAM_TOKEN=9007199254740993:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n"])
def test_invalid_cos_input_has_no_configuration_writes(tmp_path, values):
    skill_catalog(tmp_path, "cos")
    bot = tmp_path / "bots/cos-bot"
    (bot / "package.json").write_text("{}")
    (bot / "AGENTS_dedicated.md").write_text("Dedicated")
    (tmp_path / "bots/AGENTS_shared.md").write_text("Shared")
    (tmp_path / ".env").write_text("LINEAR_API_TOKEN=private-linear\n" + values)
    with patch("bot_setup.configure.run") as run, pytest.raises(click.ClickException):
        configure_source(tmp_path, role="cos")
    run.assert_not_called()
    assert not (bot / "AGENTS.md").exists()
    assert not (bot / ".pi").exists()
