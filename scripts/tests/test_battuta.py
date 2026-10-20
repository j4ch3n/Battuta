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
        cli = self.root / "memory-service/.venv/bin/battuta-memory"
        cli.parent.mkdir(parents=True)
        cli.write_text('#!/usr/bin/env bash\nprintf "%s" "$BATTUTA_MEMORY_DATA_DIR"\n')
        cli.chmod(0o700)
        for command in ("setup-memory", "memory"):
            with self.subTest(command=command):
                result = self.launch(command)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, data)

    def setUp(self):
        super().setUp()
        shutil.copy2(ROOT / "packaging" / "battuta", self.bin / "battuta")
        for role in ("pm", "tl"):
            pi = self.root / f"bots/{role}-bot/node_modules/.bin/pi"
            pi.write_text(f"#!{sys.executable}\n" + '''import json, os, sys
print(json.dumps({"role": os.environ["AGENT_ROLE"],
                   "token": os.environ.get("LINEAR_API_TOKEN"),
                   "memory": os.environ.get("BATTUTA_MEMORY_URL"), "args": sys.argv[1:]}))
''')
            pi.chmod(0o700)

    def launch(self, role):
        env = dict(os.environ)
        env.pop("LINEAR_API_TOKEN", None)
        return subprocess.run(["bash", str(self.bin / "battuta"), role],
                              env=env, capture_output=True, text=True)

    def test_both_roles_receive_token_from_production_file(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role):
                result = self.launch(role)
                self.assertEqual(result.returncode, 0, result.stderr)
                response = json.loads(result.stdout)
                self.assertEqual(response["role"], role)
                self.assertEqual(response["token"], "linear-test")
                self.assertEqual(response["memory"], "http://127.0.0.1:8901/mcp")
                self.assertIn(str(self.root / "project-spec/index.ts"), response["args"])
                self.assertIn(str(self.root / "memory-client/index.ts"), response["args"])

    def test_both_roles_honor_the_same_endpoint_override(self):
        path = "http://127.0.0.1:8989/mcp"
        with (self.root / ".env.prod").open("a") as output:
            output.write(f'BATTUTA_MEMORY_URL="{path}"\n')
        for role in ("pm", "tl"):
            response = self.launch(role)
            self.assertEqual(response.returncode, 0, response.stderr)
            self.assertEqual(json.loads(response.stdout)["memory"], str(path))

    def test_missing_token_stops_before_launch(self):
        path = self.root / ".env.prod"
        path.write_text(path.read_text().replace("LINEAR_API_TOKEN=linear-test\n", ""))
        result = self.launch("pm")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Set LINEAR_API_TOKEN in .env.prod", result.stderr)
        self.assertEqual(result.stdout, "")
