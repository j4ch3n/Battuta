"""PM setup bootstraps the scheduler helper before running it."""

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from click.testing import CliRunner

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("configure_pm", ROOT / "bots/pm-bot/scripts/configure-bot.py")
configure_pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure_pm)


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
                result = CliRunner().invoke(configure_pm.main, ["--bot-dir", str(bot), "--env-file", str(env_file)])
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertEqual(mocks["configure_mcp"].call_args.args, (bot.resolve(), env_file.resolve(), values))
                self.assertEqual(mocks["configure_mcp"].call_args.kwargs, {"role": "pm"})
                calls = mocks["run"].call_args_list
                self.assertEqual(calls[0].args, ("pnpm", "--dir", str(ROOT / "memory-client"), "install", "--frozen-lockfile"))
                self.assertEqual(calls[1].args, ("node", str(ROOT / "memory-client/configure-scheduler.mjs"), "--initialize"))
                self.assertEqual(calls[1].kwargs["env"], {**os.environ, **values})
                self.assertEqual(len(calls), 2)
