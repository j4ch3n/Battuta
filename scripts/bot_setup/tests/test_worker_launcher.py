"""Launcher prepares private configuration and execs the ordinary CLI (stubbed)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from bot_setup.browser import configure_browser
from bot_setup.mcp import configure_mcp
from bot_setup.extensions import prepare_source_extensions, profile_settings
from bot_setup.manifest import load_profile
from skill_fixtures import manifest_text

ROOT = Path(__file__).resolve().parents[3]


class WorkerLauncherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        home = patch.dict(os.environ, {"HOME": str(self.home)})
        home.start()
        self.addCleanup(home.stop)

    def test_launch_exports_worker_context_without_telegram_or_scheduler(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory).resolve()
            scripts = root / "scripts/bot_setup"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
            bot = self.home / ".battuta/pi-bots/worker-1"
            (bot / ".pi").mkdir(parents=True)
            (bot / ".pi/settings.json").write_text("{}")
            (bot / ".pi/mcp.json").write_text("{}")
            runtime = root / "assignment-worker"
            cli = runtime / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("fixture")
            (root / "bots/worker").mkdir(parents=True)
            (root / "bots/worker/bot.toml").write_text(manifest_text("worker", []))
            configure_browser(root / "bots/worker", bot, home=self.home, bot="worker-1")
            binary = root / "bin"
            binary.mkdir()
            node = binary / "node"
            node.write_text("#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({'args':sys.argv[1:],'role':os.environ.get('AGENT_ROLE'),'agentDir':os.environ.get('PI_CODING_AGENT_DIR'),'private':[key for key in os.environ if 'TELEGRAM' in key or key.startswith('PI_SCHEDULER')]}))\n")
            node.chmod(0o755)
            chromium = binary / "chromium-browser"
            chromium.write_text("#!/bin/sh\nexit 99\n")
            chromium.chmod(0o700)
            env_file = root / ".env"
            env_file.write_text("WORKER_BOT_COUNT=1\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
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
            env_file.write_text("SUPABASE_URL=http://127.0.0.1:54321\n")
            failed = subprocess.run(args, env=env, text=True, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn("private-sentinel", failed.stdout + failed.stderr)

    def test_first_launch_copies_generated_mcp_and_rebases_shared_settings(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory).resolve()
            scripts = root / "scripts/bot_setup"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
            profile = root / "bots/worker"
            (profile / ".pi").mkdir(parents=True)
            (profile / "bot.toml").write_text(manifest_text("worker", []).replace(
                'pi_coding_agent_dir = "{instance}/.pi"',
                'pi_coding_agent_dir = "{instance}/runtime/.pi"',
            ))
            (profile / "AGENTS.md").write_text("profile instructions")
            manifest = load_profile(profile / "bot.toml", "worker")
            (profile / ".pi/settings.json").write_text(json.dumps(profile_settings(manifest, browser=True)))
            source = root / "assignment-worker/index.ts"
            source.parent.mkdir(parents=True)
            source.write_text("export default () => {}")
            prepare_source_extensions(root, profile, manifest.extensions)
            configure_mcp(profile, role="worker", supabase_url="http://127.0.0.1:54321")
            (profile / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture mobile browser"}}')
            (profile / ".pi/auth.json").write_text("never-copy")
            cli = root / "assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("fixture")
            binary = root / "bin"
            binary.mkdir()
            node = binary / "node"
            node.write_text('#!/bin/sh\nprintf "%s\\n" "$PI_CODING_AGENT_DIR" "$PWD" "$BATTUTA_BOT_NAME"\n')
            node.chmod(0o755)
            chromium = binary / "chromium-browser"
            chromium.write_text("#!/bin/sh\nexit 99\n")
            chromium.chmod(0o700)
            (root / ".env").write_text("WORKER_BOT_COUNT=1\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
            bot = self.home / ".battuta/pi-bots/worker-1/runtime"
            env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}"}
            args = ["bash", str(scripts / "run-worker.sh"), "--bot-dir", str(bot)]
            first = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(first.stdout.splitlines(), [str(bot / ".pi"), str(profile), "worker-1"])
            settings = json.loads((bot / ".pi/settings.json").read_text())
            self.assertEqual(settings["defaultThinkingLevel"], "high")
            self.assertTrue(settings["defaultModel"])
            self.assertNotIn("extensions", settings)
            self.assertEqual(settings["packages"], manifest.packages.pi)
            self.assertEqual((profile / ".pi/extensions/assignment-worker.ts").resolve(), source)
            self.assertFalse((bot / "AGENTS.md").exists())
            self.assertEqual((bot / ".pi/mcp.json").read_bytes(), (profile / ".pi/mcp.json").read_bytes())
            self.assertEqual((bot / ".pi/web-search.json").read_bytes(), (profile / ".pi/web-search.json").read_bytes())
            self.assertNotIn("private-sentinel", (bot / ".pi/mcp.json").read_text())
            self.assertFalse((bot / ".pi/auth.json").exists())
            settings["theme"] = "custom"
            private_settings = json.dumps(settings)
            (bot / ".pi/settings.json").write_text(private_settings)
            (bot / ".pi/mcp.json").unlink()
            (bot / ".pi/web-search.json").unlink()
            missing_mcp = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(missing_mcp.returncode, 0, missing_mcp.stderr)
            self.assertEqual((bot / ".pi/mcp.json").read_bytes(), (profile / ".pi/mcp.json").read_bytes())
            self.assertEqual((bot / ".pi/web-search.json").read_bytes(), (profile / ".pi/web-search.json").read_bytes())
            self.assertEqual((bot / ".pi/settings.json").read_text(), private_settings)
            for name in ("auth.json", "mcp.json", "web-search.json"):
                (bot / ".pi" / name).write_text("private-state")
            again = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(again.returncode, 0, again.stderr)
            self.assertEqual((bot / ".pi/settings.json").read_text(), private_settings)
            for name in ("auth.json", "mcp.json", "web-search.json"):
                self.assertEqual((bot / ".pi" / name).read_text(), "private-state")

    def test_missing_shared_mcp_stops_before_launch_with_configuration_command(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory)
            scripts = root / "scripts/bot_setup"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")
            cli = root / "assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("fixture")
            (root / "bots/worker").mkdir(parents=True)
            (root / "bots/worker/bot.toml").write_text(manifest_text("worker", []))
            bot = self.home / ".battuta/pi-bots/worker-1"
            (bot / ".pi").mkdir(parents=True)
            (bot / ".pi/settings.json").write_text("{}")
            env_file = root / ".env"
            env_file.write_text("WORKER_BOT_COUNT=1\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-sentinel\n")
            binary = root / "bin"
            binary.mkdir()
            node = binary / "node"
            node.write_text("#!/bin/sh\nprintf 'unexpected-launch\\n'\n")
            node.chmod(0o755)
            result = subprocess.run(["bash", str(scripts / "run-worker.sh"), "--bot-dir", str(bot)],
                                    env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}"}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertIn("--role worker", result.stderr)
            self.assertNotIn("private-sentinel", result.stderr)
            self.assertFalse((bot / ".pi/mcp.json").exists())

if __name__ == "__main__":
    unittest.main()
