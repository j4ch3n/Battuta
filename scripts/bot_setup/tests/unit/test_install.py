"""Bot setup installs Telegram without reintroducing an MCP replacement."""

import os
from unittest.mock import patch

import click
import pytest

from bot_setup.install import install_packages


def pi_install(source):
    return ("pnpm", "exec", "pi", "install", "-l", "--approve", source)


@pytest.mark.parametrize("packages", [
    ["npm:telegram"],
    ["npm:telegram", "npm:@jl1990/pi-scheduler@0.5.1"],
], ids=["telegram-only", "additional-packages"])
def test_installs_each_package_with_bot_local_state_before_listing(tmp_path, packages):
    bot = tmp_path / "bots/cos-bot"
    with patch("bot_setup.install.shutil.which", return_value="pnpm"), patch("bot_setup.install.subprocess.run") as run:
        install_packages(bot, packages)
    assert [call.args[0] for call in run.call_args_list] == [
        ("pnpm", "install", "--frozen-lockfile"),
        *map(pi_install, packages),
        ("pnpm", "exec", "pi", "list"),
    ]
    for call in run.call_args_list:
        assert call.kwargs["cwd"] == bot
        assert call.kwargs["check"]
    for call in run.call_args_list[1:]:
        assert call.kwargs["env"] == {**os.environ, "PI_CODING_AGENT_DIR": str(bot / ".pi")}


def test_missing_pnpm_reports_prerequisite(tmp_path):
    with patch("bot_setup.install.shutil.which", return_value=None):
        with pytest.raises(click.ClickException, match="pnpm is required"):
            install_packages(tmp_path / "bots/cos-bot", ["npm:telegram"])
