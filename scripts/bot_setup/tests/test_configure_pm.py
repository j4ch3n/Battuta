"""PM setup bootstraps the scheduler helper before running it."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from click.testing import CliRunner

from bot_setup import configure as configure_pm
from bot_setup.cli import main

ROOT = Path(__file__).resolve().parents[3]


class ConfigurePmTests(unittest.TestCase):
    def test_dependencies_precede_helper_and_selected_environment_reaches_it(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory)
            (bot / "package.json").write_text("{}")
            env_file = bot / ".env"
            env_file.write_text("")
            values = {"PI_SCHEDULER_STATE_FILE": str(bot / "stable jobs.json")}
            with patch.multiple(configure_pm, **{name: unittest.mock.DEFAULT for name in (
                "configure_instructions", "read_env", "required", "configure_telegram",
                "configure_mcp", "configure_memory_settings", "install_packages", "warn_running_session", "run",
            )}) as mocks:
                mocks["read_env"].return_value = values
                result = CliRunner().invoke(main, ["configure", "--role", "pm", "--root", str(ROOT), "--bot-dir", str(bot), "--env-file", str(env_file)])
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertEqual(mocks["configure_mcp"].call_args.args, (bot.resolve(),))
                self.assertEqual(mocks["configure_mcp"].call_args.kwargs, {"role": "pm", "memory_url": None})
                calls = mocks["run"].call_args_list
                self.assertEqual(calls[0].args, ("pnpm", "--dir", str(ROOT / "memory-client"), "install", "--frozen-lockfile"))
                self.assertEqual(calls[1].args, ("node", str(ROOT / "memory-client/configure-scheduler.mjs"), "--initialize"))
                self.assertEqual(calls[1].kwargs["env"], {**os.environ, **values})
                self.assertEqual(len(calls), 2)
