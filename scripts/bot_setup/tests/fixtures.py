"""Temporary checkout and runtime-boundary fixtures for script tests."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from bot_setup.browser import configure_browser

ROOT = Path(__file__).resolve().parents[3]


def copy_scheduler_runtime(root):
    """Copy only the launch/setup boundary, using explicitly installed runtime deps."""
    dependencies = ROOT / "memory-client/node_modules"
    if not dependencies.is_dir():
        raise RuntimeError("Run pnpm --dir memory-client install --frozen-lockfile --prod before support checks")
    client = root / "memory-client"
    client.mkdir()
    for name in ("package.json", "configure-scheduler.mjs", "scheduler-config.ts", "scheduler-store.ts"):
        shutil.copy2(ROOT / "memory-client" / name, client / name)
    (client / "node_modules").symlink_to(dependencies, target_is_directory=True)


class ConfigFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="battuta scripts ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / "home"
        home = patch.dict(os.environ, {"HOME": str(self.home)})
        home.start()
        self.addCleanup(home.stop)
        (self.root / "scripts").mkdir()
        for name in ("setup-memory.sh", "setup-artifacts.sh"):
            shutil.copy2(ROOT / "scripts" / name, self.root / "scripts" / name)
        shutil.copy2(ROOT / "Makefile", self.root / "Makefile")
        for role in ("cos", "manager"):
            bot = self.root / f"bots/{role}-bot"
            (bot / ".pi").mkdir(parents=True)
            shutil.copy2(ROOT / f"bots/{role}-bot/bot.toml", bot / "bot.toml")
        self.config_path("cos").parent.mkdir(parents=True)
        self.config_path("cos").write_text(json.dumps({
                "profiles": {"default": {
                    "botToken": "9:old", "botId": 9, "allowedUserId": 9,
                    "botUsername": "old_bot", "customSetting": True,
                }, "other": {"preserve": True}}, "custom": True,
            }))
        self.write_env(".env", 101)
        self.write_env(".env.prod", 201)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "tmux.jsonl"
        self.executable("uv", '''import os, sys
args = sys.argv[1:]
os.execv(sys.executable, [sys.executable, "-m", "bot_setup.cli", *args[args.index("battuta-bot-setup") + 1:]])
''')

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o700)

    def config_path(self, role):
        if role == "cos":
            return self.home / ".battuta/pi-bots/cos-bot/.pi/telegram.json"
        return self.root / f"bots/{role}-bot/.pi/telegram.json"

    def config(self, role):
        return json.loads(self.config_path(role).read_text())

    def write_env(self, filename, cos):
        (self.root / filename).write_text(
            f"COS_TELEGRAM_TOKEN={cos}:cos-secret\n"
            "TELEGRAM_ALLOWED_USER_ID=123\n"
            "COS_TELEGRAM_BOT_USERNAME=new_cos_bot\n"
            "LINEAR_API_TOKEN=linear-test\n"
            "SUPABASE_URL=http://localhost:54321\n"
            "SUPABASE_SECRET_KEY=supabase-test\n"
            "WORKER_BOT_COUNT=1\n"
        )

    def refresh(self, filename=".env"):
        return subprocess.run([sys.executable, "-m", "bot_setup.cli", "refresh-telegram", "--root", str(self.root),
                               str(self.root / filename)], capture_output=True, text=True)


class LauncherFixture(ConfigFixture):
    def setUp(self):
        super().setUp()
        launcher = self.root / "scripts/bot_setup/run-dev.sh"
        launcher.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/bot_setup/run-dev.sh", launcher)
        for role in ("cos", "manager"):
            bot = self.root / f"bots/{role}-bot"
            (bot / "node_modules/.bin").mkdir(parents=True)
            (bot / "node_modules/.bin/pi").touch(mode=0o700)
            (bot / "AGENTS.md").touch()
            private_pi = self.home / f".battuta/pi-bots/{role}-bot/.pi"
            private_pi.mkdir(parents=True, exist_ok=True)
            (private_pi / "mcp.json").write_text("{}")
        configure_browser(self.root / "bots/cos-bot", self.home / ".battuta/pi-bots/cos-bot", home=self.home, bot="cos-bot")
        self.executable("chromium-browser", "raise RuntimeError('Do not launch Chromium in tests')\n")
        (self.root / "agent-mail/node_modules").mkdir(parents=True)
        (self.root / "project-spec/node_modules").mkdir(parents=True)
        copy_scheduler_runtime(self.root)
        self.scheduler = self.root / "stable schedules/schedule-prompts.json"
        self.scheduler.parent.mkdir()
        self.scheduler.write_text('{"version":2,"revision":0,"tasks":[]}')
        for name in (".env", ".env.prod"):
            with (self.root / name).open("a") as output:
                output.write(f'PI_SCHEDULER_STATE_FILE="{self.scheduler}"\n')
        (self.root / "supabase").mkdir()
        (self.root / "supabase/.env").touch()
        self.executable("tmux", '''import json, os, sys
args = sys.argv[1:]
with open(os.environ["TMUX_LOG"], "a") as output:
    output.write(json.dumps(args) + "\\n")
if args[0] == "has-session":
    sys.exit(0 if os.environ["SESSION_EXISTS"] == "1" else 1)
if "-P" in args:
    print({"new-session": "%1", "split-window": "%2", "new-window": "%3"}[args[0]])
''')
        for name in ("supabase", "make"):
            self.executable(name, "")
        self.home = self.root / "home"
        self.worker = self.home / ".battuta/pi-bots/worker-1"
        (self.worker / ".pi").mkdir(parents=True)
        for name in ("AGENTS.md", ".pi/settings.json", ".pi/mcp.json", ".pi/auth.json"):
            (self.worker / name).write_text("{}")
        cli = self.root / "bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
        cli.parent.mkdir(parents=True)
        cli.touch()
        shutil.copy2(ROOT / "bots/worker/bot.toml", self.root / "bots/worker/bot.toml")
        scripts = self.root / "scripts/bot_setup"
        scripts.mkdir(exist_ok=True)
        shutil.copy2(ROOT / "scripts/bot_setup/run-worker.sh", scripts / "run-worker.sh")

    def run_launcher(self, mode, existing=True):
        env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:{os.environ['PATH']}",
                   TMUX_LOG=str(self.log), SESSION_EXISTS=str(int(existing)))
        env.pop("TMUX", None)
        return subprocess.run([shutil.which("make"), mode], env=env,
                              capture_output=True, text=True, cwd=self.root)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def respawn_targets(self):
        return [c[c.index("-t") + 1] for c in self.commands() if c[0] == "respawn-pane"]
