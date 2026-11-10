"""Launcher orchestration, independent of Telegram refresh implementation."""

import os
import json
import subprocess
import sys
import shutil

from fixtures import LauncherFixture, ROOT


def test_shared_launcher_rejects_invalid_mode_from_an_unrelated_cwd(tmp_path):
    result = subprocess.run(
        ["bash", str(ROOT / "scripts/bot_setup/run-dev.sh"), "invalid"],
        cwd=tmp_path, capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "dev|prod" in result.stderr


class RunDevTests(LauncherFixture):
    def test_configured_worker_count_controls_distinct_panes(self):
        for count in (0, 1, 3):
            with self.subTest(count=count):
                path = self.root / ".env"
                text = path.read_text()
                import re
                path.write_text(re.sub(r"WORKER_BOT_COUNT=\d+", f"WORKER_BOT_COUNT={count}", text))
                self.log.unlink(missing_ok=True)
                result = self.run_launcher("dev", existing=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                workers = [c for c in self.commands() if c[0] == "split-window" and "--bot-dir" in c[-1]]
                self.assertEqual(len(workers), count)
                for number, call in enumerate(workers, 1):
                    self.assertIn(f".battuta/pi-bots/worker-{number}", call[-1])

    def test_invalid_count_fails_before_reattach(self):
        path = self.root / ".env"
        path.write_text(path.read_text().replace("WORKER_BOT_COUNT=1", "WORKER_BOT_COUNT=invalid"))
        result = self.run_launcher("dev", existing=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_manager_and_memory_panes_keep_tool_path_with_stale_tmux_environment(self):
        self.executable("battuta-project", "")
        self.executable("battuta-memory", "print('installed-memory')\n")
        binary = self.root / "bin"
        binary.mkdir(exist_ok=True)
        launcher = binary / "battuta"
        launcher.write_text('#!/bin/sh\nexec battuta-memory\n')
        launcher.chmod(0o700)
        pi = self.root / "bots/manager-bot/node_modules/.bin/pi"
        pi.write_text(f"#!{sys.executable}\nimport shutil\nprint(shutil.which('battuta-project'))\n")
        result = self.run_launcher("prod", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        for call in self.commands():
            if "AGENT_ROLE=manager" not in call[-1] and call[0] != "new-window":
                continue
            with self.subTest(pane=call[0]):
                pane = subprocess.run(["bash", "-c", call[-1]], env={**os.environ, "PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
                self.assertEqual(pane.returncode, 0, pane.stderr)
                expected = str(self.bin / "battuta-project") if "AGENT_ROLE=manager" in call[-1] else "installed-memory"
                self.assertEqual(pane.stdout.strip(), expected)

    def test_release_memory_pane_uses_installed_tool_through_release_launcher(self):
        binary = self.root / "bin"
        binary.mkdir(exist_ok=True)
        launcher = binary / "battuta"
        launcher.write_text('#!/bin/sh\ntest "$*" = memory || exit 99\nprintf installed-memory\n')
        launcher.chmod(0o700)
        result = self.run_launcher("prod", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        command = next(call[-1] for call in self.commands() if call[0] == "new-window")
        pane = subprocess.run(["bash", "-c", command], capture_output=True, text=True)
        self.assertEqual(pane.returncode, 0, pane.stderr)
        self.assertEqual(pane.stdout, "installed-memory")

    def test_dev_groups_bots_and_services_in_two_horizontal_windows(self):
        result = self.run_launcher("dev", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.commands()
        windows = [c[c.index("-n") + 1] for c in commands if c[0] in ("new-session", "new-window")]
        self.assertEqual(windows, ["bots", "services"])
        splits = [c for c in commands if c[0] == "split-window"]
        self.assertEqual(len(splits), 3)
        self.assertTrue(all("-h" in c for c in splits))
        self.assertIn("AGENT_ROLE=manager", splits[0][-1])
        self.assertEqual(splits[1][-1], "exec make functions-serve")
        self.assertIn("--bot-dir", splits[2][-1])
        layouts = [c for c in commands if c[0] == "select-layout"]
        self.assertEqual(len(layouts), 2)
        self.assertTrue(all(c[-1] == "even-horizontal" for c in layouts))

    def test_dev_worker_command_requires_readiness_and_passes_private_paths(self):
        result = self.run_launcher("dev", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        command = next(c[-1] for c in self.commands() if "--bot-dir" in c[-1])
        (self.root / "scripts/bot_setup/run-worker.sh").write_text('printf "%s\\n" "$@"\n')
        for ready in (False, True):
            with self.subTest(ready=ready):
                (self.root / "scripts/bot_setup/wait-for-assignments.mjs").write_text(
                    f"process.exit({0 if ready else 1});\n")
                pane = subprocess.run([shutil.which("zsh") or "sh", "-c", command],
                                      capture_output=True, text=True)
                self.assertEqual(pane.returncode, 0 if ready else 1, pane.stderr)
                self.assertEqual(pane.stdout.splitlines(), [
                    "--bot-dir", str(self.worker), "--env-file", str(self.root / ".env"),
                ] if ready else [])
                self.assertNotIn("supabase-test", pane.stdout + pane.stderr)

    def test_dev_missing_worker_prerequisite_fails_before_creating_session(self):
        paths = [self.root / "bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"]
        for path in paths:
            with self.subTest(path=path):
                backup = path.with_name(path.name + ".saved")
                path.rename(backup)
                try:
                    result = self.run_launcher("dev", existing=False)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(any(c[0] == "new-session" for c in self.commands()))
                    self.assertNotIn("supabase-test", result.stdout + result.stderr)
                finally:
                    backup.rename(path)

    def test_dev_launch_accepts_worker_without_private_configuration(self):
        shutil.rmtree(self.worker)
        result = self.run_launcher("dev", existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.worker.is_dir(), "tmux requires its pane cwd to exist")
        self.assertFalse((self.worker / ".pi").exists())
        self.assertTrue(any("--bot-dir" in call[-1] for call in self.commands()))

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
        for mode, expected_splits in (("dev", 3), ("prod", 2)):
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
                        self.assertEqual(str(self.root / "memory-client/index.ts") in result["args"], "AGENT_ROLE=cos" in command[-1])
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
