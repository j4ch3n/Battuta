"""Launcher validates prerequisites and runs one persistent host privately."""
import json
import os
from pathlib import Path
import shutil
import subprocess
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
            runtime = root / "assignment-worker"
            (runtime / "node_modules").mkdir(parents=True)
            (runtime / "host.ts").write_text("fixture")
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
            self.assertIn(str(runtime / "host.ts"), output["args"])
            (bot / "AGENTS.md").unlink()
            failed = subprocess.run(args, env=env, text=True, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn("private-sentinel", failed.stdout + failed.stderr)

if __name__ == "__main__":
    unittest.main()
