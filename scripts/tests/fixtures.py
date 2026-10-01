"""Temporary checkout and runtime-boundary fixtures for script tests."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ConfigFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="battuta scripts ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        shutil.copytree(ROOT / "scripts", self.root / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(ROOT / "Makefile", self.root / "Makefile")
        for role in ("pm", "tl"):
            bot = self.root / f"bots/{role}-bot"
            (bot / ".pi").mkdir(parents=True)
            self.config_path(role).write_text(json.dumps({
                "profiles": {"default": {
                    "botToken": "9:old", "botId": 9, "allowedUserId": 9,
                    "botUsername": "old_bot", "customSetting": True,
                }, "other": {"preserve": True}}, "custom": True,
            }))
        self.write_env(".env", 101, 102)
        self.write_env(".env.prod", 201, 202)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "tmux.jsonl"
        self.executable("uv", '''import os, sys
args = sys.argv[1:]
os.execv(sys.executable, [sys.executable, *args[args.index("python") + 1:]])
''')

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o700)

    def config_path(self, role):
        return self.root / f"bots/{role}-bot/.pi/telegram.json"

    def config(self, role):
        return json.loads(self.config_path(role).read_text())

    def write_env(self, filename, pm, tl):
        (self.root / filename).write_text(
            f"PM_TELEGRAM_TOKEN={pm}:pm-secret\n"
            f"TL_TELEGRAM_TOKEN={tl}:tl-secret\n"
            "TELEGRAM_ALLOWED_USER_ID=123\n"
            "PM_TELEGRAM_BOT_USERNAME=new_pm_bot\n"
            "LINEAR_API_KEY=linear-test\n"
            "SUPABASE_URL=http://localhost:54321\n"
            "SUPABASE_SECRET_KEY=supabase-test\n"
        )

    def refresh(self, filename=".env"):
        return subprocess.run([sys.executable, str(self.root / "scripts/refresh-telegram.py"),
                               str(self.root / filename)], capture_output=True, text=True)


class LauncherFixture(ConfigFixture):
    def setUp(self):
        super().setUp()
        launcher = self.root / "bots/pm-bot/scripts/run-dev.sh"
        launcher.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "bots/pm-bot/scripts/run-dev.sh", launcher)
        for role in ("pm", "tl"):
            bot = self.root / f"bots/{role}-bot"
            (bot / "node_modules/.bin").mkdir(parents=True)
            (bot / "node_modules/.bin/pi").touch(mode=0o700)
            (bot / "AGENTS.md").touch()
            (bot / ".pi/mcp.json").write_text("{}")
        (self.root / "agent-mail/node_modules").mkdir(parents=True)
        (self.root / "supabase").mkdir()
        (self.root / "supabase/.env").touch()
        self.executable("tmux", '''import json, os, sys
args = sys.argv[1:]
with open(os.environ["TMUX_LOG"], "a") as output:
    output.write(json.dumps(args) + "\\n")
if args[0] == "has-session":
    sys.exit(0 if os.environ["SESSION_EXISTS"] == "1" else 1)
if args[0] == "new-session":
    print("%1")
''')
        for name in ("supabase", "make"):
            self.executable(name, "")

    def run_launcher(self, mode, existing=True):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                   TMUX_LOG=str(self.log), SESSION_EXISTS=str(int(existing)))
        env.pop("TMUX", None)
        return subprocess.run([shutil.which("make"), mode], env=env,
                              capture_output=True, text=True, cwd=self.root)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def respawn_targets(self):
        return [c[c.index("-t") + 1] for c in self.commands() if c[0] == "respawn-pane"]
