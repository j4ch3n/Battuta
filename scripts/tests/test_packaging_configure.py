"""Release configuration installs shared skills from the archive root."""

import json
from itertools import product
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from fixtures import copy_scheduler_runtime


ROOT = Path(__file__).resolve().parents[2]


class PackagingConfigureTests(unittest.TestCase):
    def test_install_and_migrate_links_for_both_bots(self):
        for existing, settings_mode, personal in product((None, "../../../shared-skills/project-context"), ("missing", "legacy"), (None, "Personal instructions")):
            with self.subTest(existing=existing, settings_mode=settings_mode, personal=personal), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "bin").mkdir()
                shutil.copyfile(ROOT / "packaging" / "configure.mjs", root / "bin" / "configure.mjs")
                shutil.copyfile(ROOT / "packaging" / "shared-resources.mjs", root / "bin" / "shared-resources.mjs")
                shutil.copyfile(ROOT / "packaging" / "configure-subagents.mjs", root / "bin" / "configure-subagents.mjs")
                shutil.copytree(ROOT / "bot-setup", root / "bot-setup")
                copy_scheduler_runtime(root)
                source = root / "shared-skills" / "project-context"
                source.mkdir(parents=True)
                (source / "SKILL.md").write_text("Shared project context")
                references = source / "references"
                summary = references / "summary"
                summary.mkdir(parents=True)
                (summary / "prompt.md").write_text("Runtime summary prompt")
                (summary / "template.md").write_text("Runtime summary template")
                for name in ("todo", "note-taking"):
                    skill = root / "shared-skills" / name
                    skill.mkdir(parents=True)
                    (skill / "SKILL.md").write_text(name)
                (root / "bots").mkdir()
                (root / "bots" / "AGENTS_shared.md").write_text("Shared instructions")
                if personal is not None:
                    (root / "bots" / "AGENTS_personal.md").write_text(personal)
                for role in ("pm-bot", "tl-bot"):
                    bot = root / "bots" / role
                    skills = bot / ".pi" / "skills"
                    skills.mkdir(parents=True)
                    (bot / ".pi/mcp.json").write_text(json.dumps({"mcpServers": {"other": {"command": "other-server"}}}))
                    auth = bot / ".pi/mcp-auth.json"
                    auth.write_bytes(b'{"sentinel":"private-oauth-token"}\n')
                    auth.chmod(0o600)
                    shutil.copytree(ROOT / "bots" / role / ".pi/skills/memory", skills / "memory")
                    if personal is not None:
                        (bot / ".pi/ME.md").write_text("Private profile")
                    (bot / "AGENTS_dedicated.md").write_text(role)
                    packages = [
                        "npm:@llblab/pi-telegram@0.57.3", "npm:pi-mcp-adapter@2.37.0",
                        {"source": "npm:pi-mcp-adapter", "extensions": ["index.ts"]},
                        "npm:pi-web-access@0.43.0",
                        {"source": "npm:custom-tools@1.0.0", "extensions": ["read.ts"]},
                        "npm:pi-mcp-adapter-extra@1.0.0",
                        {"source": "npm:pi-memory-stone@0.1.7", "skills": ["skills"]},
                    ]
                    if settings_mode != "missing":
                        settings = {"theme": "dark", "packages": packages}
                        if settings_mode == "legacy":
                            settings["battutaMemoryCapture"] = {"enabled": True, "batchMessages": 6}
                        (bot / ".pi/settings.json").write_text(json.dumps(settings))
                    if existing:
                        (skills / "project-context").symlink_to(existing, target_is_directory=True)
                env = {
                    **os.environ,
                    "PI_SCHEDULER_STATE_FILE": str(root / "stable/schedule-prompts.json"),
                    "TELEGRAM_ALLOWED_USER_ID": "123",
                    "LINEAR_API_TOKEN": "test-linear",
                    "SUPABASE_URL": "https://example.com",
                    "SUPABASE_SECRET_KEY": "test-supabase",
                    "PM_TELEGRAM_TOKEN": "456:test-pm",
                    "TL_TELEGRAM_TOKEN": "789:test-tl",
                }
                for _ in range(2):
                    result = subprocess.run(
                        ["node", str(root / "bin" / "configure.mjs")],
                        env=env, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads((root / "stable/schedule-prompts.json").read_text()), {"version": 2, "revision": 0, "tasks": []})
                    for role in ("pm-bot", "tl-bot"):
                        link = root / "bots" / role / ".pi" / "skills" / "project-context"
                        self.assertEqual((link / "SKILL.md").read_text(), "Shared project context")
                        self.assertEqual((link / "references" / "summary" / "prompt.md").read_text(), "Runtime summary prompt")
                        self.assertEqual((link / "references" / "summary" / "template.md").read_text(), "Runtime summary template")
                        self.assertEqual(link.resolve(), source.resolve())
                        self.assertFalse(link.readlink().is_absolute())
                        for name in ("todo", "note-taking"):
                            self.assertEqual((link.parent / name / "SKILL.md").read_text(), name)
                        self.assertFalse((link.parent / "memory").is_symlink())
                        for resource in ("SKILL.md", "references/tools.md"):
                            self.assertEqual((link.parent / "memory" / resource).read_text(), (ROOT / "bots" / role / ".pi/skills/memory" / resource).read_text())
                        profile = link.parent.parent / "ME.md"
                        self.assertEqual(profile.read_text() if profile.exists() else None, "Private profile" if personal is not None else None)
                        if personal is not None:
                            self.assertEqual((root / "bots/AGENTS_personal.md").read_text(), personal)
                        self.assertEqual((root / "bots" / role / "AGENTS.md").read_text(), f"Shared instructions\n{role}")
                        mcp = json.loads((link.parent.parent / "mcp.json").read_text())
                        self.assertNotIn("test-linear", json.dumps(mcp))
                        self.assertNotIn("private-oauth-token", json.dumps(mcp) + result.stdout + result.stderr)
                        self.assertEqual(mcp["mcpServers"]["other"], {"command": "other-server"})
                        auth = link.parent.parent / "mcp-auth.json"
                        self.assertEqual(auth.read_bytes(), b'{"sentinel":"private-oauth-token"}\n')
                        self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
                        telegram = json.loads((link.parent.parent / "telegram.json").read_text())
                        self.assertEqual(telegram["profiles"]["default"]["botToken"], env[f"{role[:2].upper()}_TELEGRAM_TOKEN"])
                        self.assertEqual(telegram["profiles"]["default"]["allowedUserId"], 123)
                        self.assertEqual("luma" in mcp["mcpServers"], role == "pm-bot")
                        settings_path = link.parent.parent / "settings.json"
                        settings = json.loads(settings_path.read_text())
                        if role == "tl-bot":
                            subagents = settings.pop("subagents")
                            self.assertEqual([Path(path).resolve() for path in subagents["defaultExtensions"]], [(root / "bots/tl-bot/.pi/npm/node_modules/pi-web-access/dist").resolve()])
                            self.assertIn("web_search", subagents["agentOverrides"]["scout"]["tools"])
                        else:
                            self.assertNotIn("subagents", settings)
                        if settings_mode == "missing":
                            expected = {"battutaMemoryCapture": {"enabled": role == "pm-bot", "batchMessages": 6}}
                            if role == "pm-bot":
                                expected["packages"] = ["npm:@jl1990/pi-scheduler@0.5.1"]
                            else:
                                expected["packages"] = ["npm:pi-subagents@0.82.1"]
                            self.assertEqual(settings, expected)
                            self.assertEqual(settings_path.stat().st_mode & 0o777, 0o600)
                            continue
                        expected_packages = [
                            "npm:@llblab/pi-telegram@0.57.3", "npm:pi-web-access@0.43.0",
                            {"source": "npm:custom-tools@1.0.0", "extensions": ["read.ts"]},
                            "npm:pi-mcp-adapter-extra@1.0.0",
                        ]
                        if role == "pm-bot":
                            expected_packages.append("npm:@jl1990/pi-scheduler@0.5.1")
                        else:
                            expected_packages.append("npm:pi-subagents@0.82.1")
                        self.assertEqual(settings, {"theme": "dark", "packages": expected_packages, "battutaMemoryCapture": {"enabled": role == "pm-bot", "batchMessages": 6}})


class PackagingMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "new"
        self.old = Path(self.temporary.name) / "old bots"
        (self.root / "bin").mkdir(parents=True)
        for name in ("configure.mjs", "shared-resources.mjs", "configure-subagents.mjs", "battuta"):
            shutil.copyfile(ROOT / "packaging" / name, self.root / "bin" / name)
        (self.root / "bin/node").symlink_to(shutil.which("node"))
        shutil.copytree(ROOT / "bot-setup", self.root / "bot-setup")
        copy_scheduler_runtime(self.root)
        for name in ("project-context", "todo", "note-taking"):
            (self.root / "shared-skills" / name).mkdir(parents=True)
        (self.root / "bots").mkdir()
        (self.root / "bots/AGENTS_shared.md").write_text("Shared")
        for role in ("pm-bot", "tl-bot"):
            bot = self.root / "bots" / role
            (bot / ".pi").mkdir(parents=True)
            (bot / "AGENTS_dedicated.md").write_text(role)
            old_pi = self.old / role / ".pi"
            old_pi.mkdir(parents=True)
            (old_pi / "telegram.json").write_text(json.dumps({
                "profiles": {"default": {"botToken": f"private-{role}", "custom": True}, "extra": {"enabled": False}},
                "custom": role,
            }) + "\n")
            (old_pi / "mcp-auth.json").write_text(json.dumps({"private-oauth": role}) + "\n")
        (self.root / ".env.prod").write_text(
            "LINEAR_API_TOKEN=test-linear\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=test-supabase\n"
        )
        self.env = {key: value for key, value in os.environ.items() if "TELEGRAM" not in key}
        self.env["PI_SCHEDULER_STATE_FILE"] = str(self.root / "schedule.json")
        self.env.update(TELEGRAM_ALLOWED_USER_ID="123", PM_TELEGRAM_TOKEN="456:test-pm", TL_TELEGRAM_TOKEN="789:test-tl")

    def configure(self, *args):
        return subprocess.run(
            ["bash", str(self.root / "bin/battuta"), "configure", *args],
            env=self.env, capture_output=True, text=True,
        )

    def test_migrates_by_bot_name_preserving_bytes_and_private_permissions(self):
        for key in ("TELEGRAM_ALLOWED_USER_ID", "PM_TELEGRAM_TOKEN", "TL_TELEGRAM_TOKEN"):
            self.env.pop(key)
        for with_auth in (True, False):
            with self.subTest(with_auth=with_auth):
                if not with_auth:
                    for role in ("pm-bot", "tl-bot"):
                        (self.old / role / ".pi/mcp-auth.json").unlink()
                        (self.root / "bots" / role / ".pi/mcp-auth.json").unlink(missing_ok=True)
                for _ in range(2):
                    result = self.configure("--migrate-from", str(self.old))
                    self.assertEqual(result.returncode, 0, result.stderr)
                    for role in ("pm-bot", "tl-bot"):
                        for name in ("telegram.json", "mcp-auth.json"):
                            source = self.old / role / ".pi" / name
                            target = self.root / "bots" / role / ".pi" / name
                            if source.exists():
                                self.assertEqual(target.read_bytes(), source.read_bytes())
                                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                                self.assertEqual(source.stat().st_mode & 0o777, 0o644)
                            else:
                                self.assertFalse(target.exists())
                    self.assertNotIn("private-", result.stdout + result.stderr)

    def test_preflights_both_bots_before_copying_on_invalid_or_conflicting_state(self):
        for name, failure in product(("telegram.json", "mcp-auth.json"), ("invalid", "array", "conflict")):
            with self.subTest(name=name, failure=failure):
                source = self.old / "tl-bot/.pi" / name
                original = source.read_bytes()
                target = self.root / "bots/tl-bot/.pi" / name
                if failure == "conflict":
                    target.write_bytes(b'{"existing":"private-destination"}')
                else:
                    source.write_bytes(b'{"private-broken' if failure == "invalid" else b'[]')
                result = self.configure("--migrate-from", str(self.old))
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("private-", result.stdout + result.stderr)
                self.assertFalse((self.root / "bots/pm-bot/.pi/telegram.json").exists())
                if failure == "conflict":
                    self.assertEqual(target.read_bytes(), b'{"existing":"private-destination"}')
                    target.unlink()
                source.write_bytes(original)

    def test_missing_telegram_fails_without_env_fallback(self):
        (self.old / "tl-bot/.pi/telegram.json").unlink()
        result = self.configure("--migrate-from", str(self.old))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "bots/pm-bot/.pi/telegram.json").exists())

    def test_rejects_unknown_or_missing_arguments(self):
        for args in (("--migrate-from",), ("--unknown",), ("unexpected",)):
            with self.subTest(args=args):
                result = self.configure(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / "schedule.json").exists())
