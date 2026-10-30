"""Release package installation runs inside the staged bot workspaces."""

import os
import json
from pathlib import Path
import re
import shutil
import subprocess
import textwrap

from fixtures import ConfigFixture, ROOT


class ReleaseInstallTests(ConfigFixture):
    def test_tl_subagent_release_boundary_requires_runtime_files(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        boundary = re.search(
            r'^          test -f dist/stage/battuta/bots/tl-bot/\.pi/npm/node_modules/pi-subagents/bundle/index.js\n.*?^          test ! -e dist/stage/battuta/bots/tl-bot/\.pi/subagents.json$',
            workflow, re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(boundary)
        tl = self.root / "dist/stage/battuta/bots/tl-bot"
        extension = tl / ".pi/npm/node_modules/pi-subagents/bundle"
        extension.mkdir(parents=True)
        (extension / "index.js").write_text("// staged extension")
        references = tl / ".pi/npm/node_modules/pi-subagents/skills/pi-subagents"
        references.mkdir(parents=True)
        (references / "SKILL.md").write_text("staged native skill")
        command = ["bash", "-euc", textwrap.dedent(boundary.group())]
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for path in (extension / "index.js", references / "SKILL.md"):
            with self.subTest(missing=path.name):
                content = path.read_text()
                path.unlink()
                result = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                path.write_text(content)

    def test_archive_preserves_local_memory_skills_and_links_shared_context(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        loop = re.search(
            r'^          for bot in pm-bot tl-bot; do\n            mkdir .*?^          done$',
            workflow, re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(loop)
        stage = self.root / "dist/stage/battuta"
        for name in ("project-context", "todo", "note-taking", "draft-writing"):
            source = stage / "shared-skills" / name
            source.mkdir(parents=True)
            (source / "SKILL.md").write_text(name)
        (stage / "shared-skills/project-context/references").mkdir()
        for role in ("pm-bot", "tl-bot"):
            shutil.copytree(ROOT / "bots" / role / ".pi/skills/memory", stage / "bots" / role / ".pi/skills/memory")
        result = subprocess.run(["bash", "-euc", textwrap.dedent(loop.group())], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for role in ("pm-bot", "tl-bot"):
            memory = stage / "bots" / role / ".pi/skills/memory"
            self.assertFalse(memory.is_symlink())
            self.assertEqual((memory / "SKILL.md").read_text(), (ROOT / "bots" / role / ".pi/skills/memory/SKILL.md").read_text())
            self.assertTrue((memory / "references/tools.md").is_file())
            for name in ("project-context", "todo", "note-taking", "draft-writing"):
                self.assertTrue((memory.parent / name).is_symlink())
                self.assertEqual((memory.parent / name / "SKILL.md").read_text(), name)

    def test_packages_are_installed_from_staged_bot_settings(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        loop = re.search(
            r'^          for bot in pm-bot tl-bot; do\n            bot_dir=.*?^          done$',
            workflow, re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(loop)
        stage = self.root / "dist/stage/battuta/bots"
        expected_packages = {}
        for role in ("pm-bot", "tl-bot"):
            bot = stage / role
            (bot / "node_modules/.bin").mkdir(parents=True)
            settings = json.loads((ROOT / "bots" / role / ".pi/settings.json").read_text())
            (bot / ".pi").mkdir(exist_ok=True)
            (bot / ".pi/settings.json").write_text(json.dumps(settings))
            expected_packages[role] = [
                source.removeprefix("npm:").rsplit("@", 1)[0]
                for entry in settings["packages"]
                if isinstance(entry, str)
                if (source := entry).startswith("npm:")
            ]
            skill = bot / ".pi/skills/manage-google"
            if role == "pm-bot":
                skill.mkdir(parents=True)
                (skill / "SKILL.md").write_text("Google skill")
        self.executable("pnpm", '''import os, pathlib, sys
args = sys.argv[1:]
if args[:1] == ["--dir"]:
    os.chdir(args[1])
    args = args[2:]
if args[:1] == ["exec"]:
    os.execv(str(pathlib.Path.cwd() / "node_modules/.bin" / args[1]), args[1:])
''')
        self.executable("pi", '''import pathlib, sys
source = sys.argv[-1].removeprefix("npm:")
name, version = source.rsplit("@", 1)
package = pathlib.Path.cwd() / ".pi/npm/node_modules" / name
(package / "src").mkdir(parents=True, exist_ok=True)
(package / "src/index.ts").write_text("Extension boundary stub")
(package / "extensions/scheduler").mkdir(parents=True, exist_ok=True)
(package / "extensions/scheduler/index.ts").write_text("Extension boundary stub")
''')
        for role in ("pm-bot", "tl-bot"):
            shutil.copy2(self.bin / "pi", stage / role / "node_modules/.bin/pi")
        result = subprocess.run(
            ["bash", "-euc", textwrap.dedent(loop.group())], cwd=self.root,
            env={**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}"},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        for role in ("pm-bot", "tl-bot"):
            packages = stage / role / ".pi/npm/node_modules"
            for package in expected_packages[role]:
                self.assertTrue((packages / package).is_dir())
        self.assertFalse((self.root / ".pi/npm").exists())
