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
                copy_scheduler_runtime(root)
                source = root / "shared-skills" / "project-context"
                source.mkdir(parents=True)
                (source / "SKILL.md").write_text("Shared project context")
                references = source / "references"
                summary = references / "summary"
                summary.mkdir(parents=True)
                (summary / "prompt.md").write_text("Runtime summary prompt")
                (summary / "template.md").write_text("Runtime summary template")
                (root / "bots").mkdir()
                (root / "bots" / "AGENTS_shared.md").write_text("Shared instructions")
                if personal is not None:
                    (root / "bots" / "AGENTS_personal.md").write_text(personal)
                for role in ("pm-bot", "tl-bot"):
                    bot = root / "bots" / role
                    skills = bot / ".pi" / "skills"
                    skills.mkdir(parents=True)
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
                        self.assertFalse((link.parent / "memory").is_symlink())
                        for resource in ("SKILL.md", "references/tools.md"):
                            self.assertEqual((link.parent / "memory" / resource).read_text(), (ROOT / "bots" / role / ".pi/skills/memory" / resource).read_text())
                        profile = link.parent.parent / "ME.md"
                        self.assertEqual(profile.read_text() if profile.exists() else None, "Private profile" if personal is not None else None)
                        if personal is not None:
                            self.assertEqual((root / "bots/AGENTS_personal.md").read_text(), personal)
                        self.assertEqual((root / "bots" / role / "AGENTS.md").read_text(), f"Shared instructions\n{role}")
                        mcp = json.loads((link.parent.parent / "mcp.json").read_text())
                        self.assertEqual(
                            mcp["mcpServers"]["linear"]["headers"], {"Authorization": "Bearer ${LINEAR_API_TOKEN}"},
                        )
                        self.assertEqual(mcp["mcpServers"]["linear"]["exposure"], "codemode")
                        self.assertNotIn("test-linear", json.dumps(mcp))
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
