"""Launcher prepares private configuration and execs the ordinary CLI (stubbed)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class WorkerLauncherTests(unittest.TestCase):
    def test_launch_exports_worker_context_without_telegram_or_scheduler(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory)
            scripts = root / "scripts/bot_setup"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
            bot = root / "private worker"
            (bot / ".pi").mkdir(parents=True)
            for file in ("AGENTS.md", ".pi/settings.json", ".pi/mcp.json"):
                (bot / file).write_text("{}")
            runtime = root / "bots/worker/extension/assignment-worker"
            cli = runtime / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("fixture")
            binary = root / "bin"
            binary.mkdir()
            node = binary / "node"
            node.write_text("#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({'args':sys.argv[1:],'role':os.environ.get('AGENT_ROLE'),'agentDir':os.environ.get('PI_CODING_AGENT_DIR'),'private':[key for key in os.environ if 'TELEGRAM' in key or key.startswith('PI_SCHEDULER')]}))\n")
            node.chmod(0o755)
            env_file = root / ".env"
            env_file.write_text("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
            env = {**os.environ, "PATH":f"{binary}:{os.environ['PATH']}", "COS_TELEGRAM_TOKEN":"private-sentinel", "PI_SCHEDULER_STATE_FILE":"private-sentinel"}
            args = ["bash", str(scripts / "run-worker.sh"), "--bot-dir", str(bot), "--env-file", str(env_file)]
            result = subprocess.run(args, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output["role"], "worker")
            self.assertEqual(output["agentDir"], str(bot / ".pi"))
            self.assertEqual(output["private"], [])
            self.assertNotIn("--print", output["args"])
            self.assertEqual(output["args"], [str(cli)])
            (bot / "AGENTS.md").unlink()
            failed = subprocess.run(args, env=env, text=True, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn("private-sentinel", failed.stdout + failed.stderr)

    def test_first_launch_initializes_from_prepared_profile_without_touching_auth(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory).resolve()
            scripts = root / "scripts/bot_setup"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
            profile = root / "bots/worker"
            (profile / ".pi").mkdir(parents=True)
            (profile / "AGENTS.md").write_text("profile instructions")
            (profile / ".pi/settings.json").write_text('{"extensions":[]}')
            (profile / ".pi/mcp.json").write_text('{"mcpServers":{}}')
            (profile / ".pi/auth.json").write_text("never-copy")
            cli = profile / "extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("fixture")
            setup = root / "scripts/packaging/.venv/bin/battuta-bot-setup"
            setup.parent.mkdir(parents=True)
            setup.write_text(f'#!{sys.executable}\nimport sys\nsys.path.insert(0,{str(ROOT / "scripts/bot_setup/src")!r})\nfrom bot_setup.cli import main\nmain()\n')
            setup.chmod(0o755)
            binary = root / "bin"
            binary.mkdir()
            node = binary / "node"
            node.write_text("#!/bin/sh\nprintf 'stub-pi\\n'\n")
            node.chmod(0o755)
            (root / ".env").write_text("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
            bot = root / "new private instance"
            env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}"}
            args = ["bash", str(scripts / "run-worker.sh"), "--bot-dir", str(bot)]
            first = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("stub-pi", first.stdout)
            self.assertEqual((bot / "AGENTS.md").read_text(), "profile instructions")
            self.assertFalse((bot / ".pi/auth.json").exists())
            (bot / ".pi/settings.json").write_text('{"theme":"custom"}')
            again = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(again.returncode, 0, again.stderr)
            self.assertEqual((bot / ".pi/settings.json").read_text(), '{"theme":"custom"}')

if __name__ == "__main__":
    unittest.main()
