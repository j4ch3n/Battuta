"""Release foreground and service entrypoint credential inheritance."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from fixtures import LauncherFixture, ROOT


class BattutaLauncherTests(LauncherFixture):
    def test_memory_commands_load_the_same_production_data_override(self):
        data = str(self.root / "private memory")
        with (self.root / ".env.prod").open("a") as output:
            output.write(f'BATTUTA_MEMORY_DATA_DIR="{data}"\n')
        setup = self.root / "scripts/setup-memory.sh"
        setup.parent.mkdir(exist_ok=True)
        setup.write_text('printf "%s" "$BATTUTA_MEMORY_DATA_DIR"\n')
        cli = self.bin / "battuta-memory"
        cli.write_text('#!/usr/bin/env bash\nprintf "%s" "$BATTUTA_MEMORY_DATA_DIR"\n')
        cli.chmod(0o700)
        for command in ("setup-memory", "memory"):
            with self.subTest(command=command):
                result = self.launch(command)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, data)

    def setUp(self):
        super().setUp()
        shutil.copy2(ROOT / "scripts/packaging/battuta", self.bin / "battuta")
        (self.bin / "battuta").chmod(0o700)
        (self.bin / "node").symlink_to(shutil.which("node"))
        for role in ("cos", "manager"):
            pi = self.root / f"bots/{role}-bot/node_modules/.bin/pi"
            pi.write_text(f"#!{sys.executable}\n" + '''import json, os, sys
print(json.dumps({"role": os.environ["AGENT_ROLE"],
                   "telegram": any("TELEGRAM" in key for key in os.environ),
                   "token": os.environ.get("LINEAR_API_TOKEN"),
                    "memory": os.environ.get("BATTUTA_MEMORY_URL"), "scheduler": os.environ.get("PI_SCHEDULER_STATE_FILE"), "catchup": os.environ.get("PI_SCHEDULER_CATCHUP_MAX"), "args": sys.argv[1:]}))
''')
            pi.chmod(0o700)

    def launch(self, role):
        env = dict(os.environ)
        env.pop("LINEAR_API_TOKEN", None)
        env["PATH"] = f"{self.bin}:{env['PATH']}"
        return subprocess.run(["bash", str(self.bin / "battuta"), role],
                              env=env, capture_output=True, text=True)

    def test_installed_artifact_commands_preserve_arguments(self):
        self.executable("battuta-artifact", "import json, sys\nprint(json.dumps(sys.argv[1:]))\n")
        for command, expected in (("artifact", []), ("artifacts", ["serve"])):
            with self.subTest(command=command):
                result = self.launch(command)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), expected)

    def test_missing_tool_never_falls_back_to_release_virtualenv(self):
        stale = self.root / "memory-service/.venv/bin/battuta-memory"
        stale.parent.mkdir(parents=True)
        stale.write_text("#!/bin/sh\nprintf stale\n")
        stale.chmod(0o700)
        result = subprocess.run(["bash", str(self.bin / "battuta"), "memory"],
                                env={**os.environ, "PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("stale", result.stdout)
        self.assertIn("uv tool install", result.stderr)

    def test_both_roles_receive_token_from_production_file(self):
        for role in ("cos", "manager"):
            with self.subTest(role=role):
                result = self.launch(role)
                self.assertEqual(result.returncode, 0, result.stderr)
                response = json.loads(result.stdout)
                self.assertEqual(response["role"], role)
                self.assertEqual(response["token"], "linear-test")
                self.assertEqual(response["memory"], "http://127.0.0.1:8901/mcp")
                if role == "cos":
                    self.assertEqual(response["scheduler"], str(self.scheduler))
                    self.assertEqual(response["catchup"], "0")
                self.assertIn(str(self.root / "project-spec/index.ts"), response["args"])
                self.assertIn(str(self.root / "memory-client/index.ts"), response["args"])

    def test_both_roles_honor_the_same_endpoint_override(self):
        path = "http://127.0.0.1:8989/mcp"
        with (self.root / ".env.prod").open("a") as output:
            output.write(f'BATTUTA_MEMORY_URL="{path}"\n')
        for role in ("cos", "manager"):
            response = self.launch(role)
            self.assertEqual(response.returncode, 0, response.stderr)
            self.assertEqual(json.loads(response.stdout)["memory"], str(path))

    def test_missing_token_stops_before_launch(self):
        path = self.root / ".env.prod"
        path.write_text(path.read_text().replace("LINEAR_API_TOKEN=linear-test\n", ""))
        result = self.launch("cos")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Set LINEAR_API_TOKEN in .env.prod", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_manager_launch_and_service_command_exclude_telegram_environment(self):
        from battuta_packaging.services import install_services
        from unittest.mock import patch
        import shlex
        for root in ("COS_TELEGRAM_TOKEN", "TELEGRAM_BOT_TOKEN", "PI_TELEGRAM_PROFILE", "TELEGRAM_ALLOWED_USER_ID"):
            with (self.root / ".env.prod").open("a") as output:
                output.write(f"{root}=private-test\n")
        with patch.dict(os.environ, {"COS_TELEGRAM_TOKEN": "private-parent", "XDG_CONFIG_HOME": str(self.root / "config")}):
            result = self.launch("manager")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)["telegram"])
            self.assertIsNone(json.loads(result.stdout)["scheduler"])
            self.assertTrue(json.loads(self.launch("cos").stdout)["telegram"])
            install_services(self.root)
            unit = (self.root / "config/systemd/user/battuta-manager.service").read_text()
            command = next(line for line in unit.splitlines() if line.startswith("ExecStart="))
            args = shlex.split(command.removeprefix("ExecStart="))
            result = subprocess.run(shlex.split(args[args.index("-c") + 1]), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)["telegram"])
