"""Launcher orchestration, independent of Telegram refresh implementation."""

import os
import json
import subprocess
import sys
import shutil

from fixtures import LauncherFixture


class RunDevTests(LauncherFixture):
    def test_manager_pane_scrubs_credentials_under_non_bash_tmux_shell(self):
        pi = self.root / "bots/manager-bot/node_modules/.bin/pi"
        pi.write_text(f"#!{sys.executable}\n" + 'import json, os\nprint(json.dumps({"telegram": any("TELEGRAM" in key for key in os.environ)}))\n')
        result = self.run_launcher("prod", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        command = next(call[-1] for call in self.commands() if "AGENT_ROLE=manager" in call[-1])
        shell = shutil.which("zsh") or shutil.which("sh")
        pane = subprocess.run([shell, "-c", command], env={**os.environ, "COS_TELEGRAM_TOKEN": "private-parent"}, capture_output=True, text=True)
        self.assertEqual(pane.returncode, 0, pane.stderr)
        self.assertFalse(json.loads(pane.stdout)["telegram"])

    def test_missing_or_corrupt_store_blocks_new_session_without_replacing_it(self):
        for text in (None, "broken"):
            with self.subTest(text=text):
                if text is None:
                    self.scheduler.unlink()
                else:
                    self.scheduler.write_text(text)
                result = self.run_launcher("prod", existing=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c[0] == "new-session" for c in self.commands()))
                self.assertEqual(self.scheduler.read_text() if self.scheduler.exists() else None, text)

    def test_production_pane_commands_pass_runtime_environment_to_bots(self):
        for role in ("cos", "manager"):
            pi = self.root / f"bots/{role}-bot/node_modules/.bin/pi"
            pi.write_text(f"#!{sys.executable}\n" + '''import json, os
print(json.dumps({"role": os.environ["AGENT_ROLE"], "token": os.environ.get("LINEAR_API_TOKEN"),
    "telegram": any("TELEGRAM" in key for key in os.environ),
    "memory": os.environ.get("BATTUTA_MEMORY_URL"), "scheduler": os.environ.get("PI_SCHEDULER_STATE_FILE"),
    "catchup": os.environ.get("PI_SCHEDULER_CATCHUP_MAX"), "umask": os.umask(0)}))
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
                outputs.append(json.loads(pane.stdout))
        path = "http://127.0.0.1:8901/mcp"
        self.assertEqual([item["role"] for item in outputs], ["cos", "manager"])
        for item in outputs:
            self.assertEqual(item["token"], "linear-test")
            self.assertEqual(item["memory"], path)
        self.assertEqual(outputs[0]["scheduler"], str(self.scheduler))
        self.assertEqual(outputs[0]["catchup"], "0")
        self.assertEqual(outputs[0]["umask"], 0o77)
        self.assertTrue(outputs[0]["telegram"])
        self.assertFalse(outputs[1]["telegram"])
        self.assertIsNone(outputs[1]["scheduler"])

    def test_shared_endpoint_override_reaches_both_processes(self):
        override = "http://127.0.0.1:8989/mcp"
        with (self.root / ".env.prod").open("a") as output:
            output.write(f'BATTUTA_MEMORY_URL="{override}"\n')
        for role in ("cos", "manager"):
            pi = self.root / f"bots/{role}-bot/node_modules/.bin/pi"
            pi.write_text(f"#!{sys.executable}\nimport os\nprint(os.environ['BATTUTA_MEMORY_URL'])\n")
        result = self.run_launcher("prod", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        for command in self.commands():
            if "AGENT_ROLE=" in command[-1]:
                pane = subprocess.run(["bash", "-c", command[-1]], capture_output=True, text=True)
                self.assertEqual(pane.returncode, 0, pane.stderr)
                self.assertEqual(pane.stdout.strip(), override)

    def test_launch_does_not_refresh_telegram_configuration(self):
        for mode in ("dev", "prod"):
            for existing in (True, False):
                with self.subTest(mode=mode, existing=existing):
                    before = self.config_path("cos").read_bytes()
                    result = self.run_launcher(mode, existing=existing)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(self.config_path("cos").read_bytes(), before)
                    self.assertFalse(self.config_path("manager").exists())
                    self.assertFalse(self.respawn_targets())

    def test_fresh_launch_uses_selected_environment_and_expected_panes(self):
        for mode, filename in (("dev", ".env"), ("prod", ".env.prod")):
            with (self.root / filename).open("a") as output:
                output.write(f'BATTUTA_TEST_MODE={mode}\n')
        for role in ("cos", "manager"):
            pi = self.root / f"bots/{role}-bot/node_modules/.bin/pi"
            pi.write_text(f"#!{sys.executable}\n" + 'import json, os, sys\nprint(json.dumps({"mode": os.environ["BATTUTA_TEST_MODE"], "args": sys.argv[1:]}))\n')
        for mode, expected_splits in (("dev", 2), ("prod", 1)):
            with self.subTest(mode=mode):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_launcher(mode, existing=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                splits = [c for c in self.commands() if c[0] == "split-window"]
                self.assertEqual(len(splits), expected_splits)
                for command in self.commands():
                    if "AGENT_ROLE=" in command[-1]:
                        pane = subprocess.run(["bash", "-c", command[-1]], capture_output=True, text=True)
                        self.assertEqual(pane.returncode, 0, pane.stderr)
                        result = json.loads(pane.stdout)
                        self.assertEqual(result["mode"], mode)
                        self.assertIn(str(self.root / "project-spec/index.ts"), result["args"])
                        self.assertIn(str(self.root / "memory-client/index.ts"), result["args"])
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
