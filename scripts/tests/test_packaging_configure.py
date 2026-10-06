"""Release configuration installs shared skills from the archive root."""

import json
from itertools import product
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class PackagingConfigureTests(unittest.TestCase):
    def test_install_and_migrate_links_for_both_bots(self):
        for existing, settings_mode, personal in product((None, "../../../shared-skills/project-context"), ("missing", "legacy", "scheduler"), (None, "Personal instructions")):
            with self.subTest(existing=existing, settings_mode=settings_mode, personal=personal), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "bin").mkdir()
                shutil.copyfile(ROOT / "packaging" / "configure.mjs", root / "bin" / "configure.mjs")
                shutil.copyfile(ROOT / "packaging" / "shared-resources.mjs", root / "bin" / "shared-resources.mjs")
                source = root / "shared-skills" / "project-context"
                source.mkdir(parents=True)
                (source / "SKILL.md").write_text("Shared project context")
                memory_skill = root / "shared-skills/memory"
                memory_skill.mkdir()
                (memory_skill / "SKILL.md").write_text("Memory scope guidance")
                shutil.copytree(ROOT / "shared-skills/memory/references", memory_skill / "references")
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
                    if personal is not None:
                        (bot / ".pi/ME.md").write_text("Private profile")
                    (bot / "AGENTS_dedicated.md").write_text(role)
                    packages = [
                        "npm:@llblab/pi-telegram@0.50.1", "npm:pi-mcp-adapter@2.37.0",
                        {"source": "npm:pi-mcp-adapter", "extensions": ["index.ts"]},
                        "npm:pi-web-access@0.35.0",
                        {"source": "npm:custom-tools@1.0.0", "extensions": ["read.ts"]},
                        "npm:pi-mcp-adapter-extra@1.0.0",
                        {"source": "npm:pi-memory-stone@0.1.7", "skills": ["skills"]},
                    ]
                    if settings_mode == "scheduler" and role == "pm-bot":
                        packages.append({"source": "npm:pi-schedule-prompt@0.4.1", "extensions": ["src/index.ts"]})
                    if settings_mode != "missing":
                        (bot / ".pi/settings.json").write_text(json.dumps({"theme": "dark", "packages": packages}))
                    if existing:
                        (skills / "project-context").symlink_to(existing, target_is_directory=True)
                env = {
                    **os.environ,
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
                    for role in ("pm-bot", "tl-bot"):
                        link = root / "bots" / role / ".pi" / "skills" / "project-context"
                        self.assertEqual((link / "SKILL.md").read_text(), "Shared project context")
                        self.assertEqual((link / "references" / "summary" / "prompt.md").read_text(), "Runtime summary prompt")
                        self.assertEqual((link / "references" / "summary" / "template.md").read_text(), "Runtime summary template")
                        self.assertEqual(link.resolve(), source.resolve())
                        self.assertFalse(link.readlink().is_absolute())
                        self.assertEqual((link.parent / "memory/SKILL.md").read_text(), "Memory scope guidance")
                        for resource in ("ME.template.md", "profile-rewrite-prompt.md"):
                            self.assertEqual((link.parent / "memory/references" / resource).read_text(), (ROOT / "shared-skills/memory/references" / resource).read_text())
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
                        if settings_mode == "missing":
                            expected = {"battutaMemory": {"ownerProfile": role == "pm-bot"}}
                            if role == "pm-bot":
                                expected["packages"] = ["npm:pi-schedule-prompt@0.4.1"]
                            self.assertEqual(json.loads(settings_path.read_text()), expected)
                            self.assertEqual(settings_path.stat().st_mode & 0o777, 0o600)
                            continue
                        settings = json.loads(settings_path.read_text())
                        expected_packages = [
                            "npm:@llblab/pi-telegram@0.50.1", "npm:pi-web-access@0.35.0",
                            {"source": "npm:custom-tools@1.0.0", "extensions": ["read.ts"]},
                            "npm:pi-mcp-adapter-extra@1.0.0",
                        ]
                        if role == "pm-bot":
                            expected_packages.append(
                                {"source": "npm:pi-schedule-prompt@0.4.1", "extensions": ["src/index.ts"]}
                                if settings_mode == "scheduler" else "npm:pi-schedule-prompt@0.4.1"
                            )
                        self.assertEqual(settings, {"theme": "dark", "packages": expected_packages, "battutaMemory": {"ownerProfile": role == "pm-bot"}})
