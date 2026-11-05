"""Disposable release and runtime-boundary fixtures; no checkout copies."""

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


def copy_scheduler_runtime(root):
    client = root / "memory-client"
    client.mkdir()
    for name in ("package.json", "configure-scheduler.mjs", "scheduler-config.ts", "scheduler-store.ts"):
        shutil.copy2(ROOT / "memory-client" / name, client / name)
    (client / "node_modules").symlink_to(ROOT / "memory-client/node_modules", target_is_directory=True)


def installed_tools(root):
    """Stub only installation; execute the real installed Python CLI code."""
    binary = root / "bin"
    binary.mkdir(parents=True, exist_ok=True)
    for command, module in (("battuta-bot-setup", "bot_setup.cli"), ("battuta-packaging", "battuta_packaging.cli")):
        script = binary / command
        script.write_text(f"#!{sys.executable}\nfrom {module} import main\nmain()\n")
        script.chmod(0o700)


class ConfigFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="battuta-release-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.bin = self.root / "bin"
        self.bin.mkdir()

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o700)


class LauncherFixture(ConfigFixture):
    def setUp(self):
        super().setUp()
        for role in ("cos", "manager"):
            bot = self.root / f"bots/{role}-bot"
            (bot / "node_modules/.bin").mkdir(parents=True)
            (bot / ".pi").mkdir()
            (bot / "AGENTS.md").touch()
            (bot / ".pi/mcp.json").write_text("{}")
            if role == "cos":
                (bot / ".pi/telegram.json").write_text("{}")
        for name in ("agent-mail", "project-spec"):
            (self.root / name / "node_modules").mkdir(parents=True)
        (self.root / "scripts").mkdir()
        copy_scheduler_runtime(self.root)
        self.scheduler = self.root / "stable-schedules/schedule-prompts.json"
        self.scheduler.parent.mkdir()
        self.scheduler.write_text('{"version":2,"revision":0,"tasks":[]}')
        (self.root / ".env.prod").write_text(f'LINEAR_API_TOKEN=linear-test\nSUPABASE_URL=http://localhost\nSUPABASE_SECRET_KEY=test\nPI_SCHEDULER_STATE_FILE="{self.scheduler}"\n')
