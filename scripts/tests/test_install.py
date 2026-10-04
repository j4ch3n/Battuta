"""Bot setup installs Telegram without reintroducing an MCP replacement."""

import os
from pathlib import Path
import sys
from unittest.mock import patch

import click

from fixtures import ConfigFixture

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.install import install_packages  # noqa: E402


class InstallTests(ConfigFixture):
    def test_installs_additional_packages_before_listing(self):
        bot = self.root / "bots/custom-pm"
        with patch("bot_setup.install.shutil.which", return_value="pnpm"), patch("bot_setup.install.subprocess.run") as run:
            install_packages(bot, "npm:telegram", extra_packages=("npm:pi-schedule-prompt@0.4.1",))
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ("pnpm", "install", "--frozen-lockfile"),
            ("pnpm", "exec", "pi", "install", "-l", "--approve", "npm:telegram"),
            ("pnpm", "exec", "pi", "install", "-l", "--approve", "npm:pi-schedule-prompt@0.4.1"),
            ("pnpm", "exec", "pi", "list"),
        ])
        for call in run.call_args_list[1:]:
            self.assertEqual(call.kwargs["cwd"], bot)
            self.assertEqual(call.kwargs["env"]["PI_CODING_AGENT_DIR"], str(bot / ".pi"))

    def test_installs_only_telegram_with_bot_local_state(self):
        bot = self.root / "bots/pm-bot"
        with patch("bot_setup.install.shutil.which", return_value="pnpm"), patch("bot_setup.install.subprocess.run") as run:
            install_packages(bot, "npm:@llblab/pi-telegram@0.50.1")
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ("pnpm", "install", "--frozen-lockfile"),
            ("pnpm", "exec", "pi", "install", "-l", "--approve", "npm:@llblab/pi-telegram@0.50.1"),
            ("pnpm", "exec", "pi", "list"),
        ])
        for call in run.call_args_list:
            self.assertEqual(call.kwargs["cwd"], bot)
            self.assertTrue(call.kwargs["check"])
        self.assertEqual(run.call_args_list[1].kwargs["env"], {**os.environ, "PI_CODING_AGENT_DIR": str(bot / ".pi")})

    def test_missing_pnpm_reports_prerequisite(self):
        with patch("bot_setup.install.shutil.which", return_value=None):
            with self.assertRaisesRegex(click.ClickException, "pnpm is required"):
                install_packages(self.root / "bots/pm-bot", "npm:telegram")
