"""Launcher orchestration, independent of Telegram refresh implementation."""

import os
import subprocess
import sys

from fixtures import LauncherFixture


class RunDevTests(LauncherFixture):
    def test_production_pane_commands_export_token_to_both_bots(self):
        for role in ("pm", "tl"):
            pi = self.root / f"bots/{role}-bot/node_modules/.bin/pi"
            pi.write_text(f"#!{sys.executable}\n" + '''import os
print(os.environ["AGENT_ROLE"] + ":" + os.environ.get("LINEAR_API_TOKEN", "") + ":" + os.environ.get("PI_MEMORY_STONE_DB_PATH", ""))
''')
        result = self.run_launcher("prod", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        env = dict(os.environ)
        env.pop("LINEAR_API_TOKEN", None)
        outputs = []
        for command in self.commands():
            if "AGENT_ROLE=" in command[-1]:
                pane = subprocess.run(["bash", "-c", command[-1]], env=env,
                                      capture_output=True, text=True)
                self.assertEqual(pane.returncode, 0, pane.stderr)
                outputs.append(pane.stdout.strip())
        self.assertEqual(outputs, [f"pm:linear-test:{self.root.resolve()}/bots/pm-bot/.pi/memory/memory.db", "tl:linear-test:"])

    def test_launch_does_not_refresh_telegram_configuration(self):
        for mode in ("dev", "prod"):
            for existing in (True, False):
                with self.subTest(mode=mode, existing=existing):
                    before = {role: self.config_path(role).read_text() for role in ("pm", "tl")}
                    result = self.run_launcher(mode, existing=existing)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    for role in ("pm", "tl"):
                        self.assertEqual(self.config_path(role).read_text(), before[role])
                    self.assertFalse(self.respawn_targets())

    def test_fresh_launch_uses_selected_environment_and_expected_panes(self):
        for mode, expected_splits in (("dev", 2), ("prod", 1)):
            with self.subTest(mode=mode):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_launcher(mode, existing=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                splits = [c for c in self.commands() if c[0] == "split-window"]
                self.assertEqual(len(splits), expected_splits)
                selected = self.root / (".env" if mode == "dev" else ".env.prod")
                for command in self.commands():
                    if "AGENT_ROLE=" in command[-1]:
                        self.assertIn(str(selected), command[-1].replace("\\ ", " "))
                        self.assertIn(str(self.root / "project-spec/index.ts"), command[-1].replace("\\ ", " "))
                self.assertEqual(self.commands()[-1], ["attach-session", "-t", f"=battuta-{mode}"])

    def test_existing_session_only_attaches(self):
        for mode in ("dev", "prod"):
            with self.subTest(mode=mode):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_launcher(mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.commands(), [
                    ["has-session", "-t", f"=battuta-{mode}"],
                    ["attach-session", "-t", f"=battuta-{mode}"],
                ])
