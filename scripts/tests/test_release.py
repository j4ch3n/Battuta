"""Release package installation runs inside the staged bot workspaces."""

import os
import json
from pathlib import Path
import re
import shutil
import subprocess
import textwrap
import tempfile
import unittest

from fixtures import ConfigFixture, ROOT
from skill_fixtures import skill_catalog


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

    def test_archive_skills_are_fixed_portable_and_repeatable_from_fresh_staging(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        assembly = re.search(
            r'^          node packaging/stage-skills\.mjs dist/stage/battuta\n(?:          rm -rf dist/stage/battuta/skills-hub\n)?',
            workflow, re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(assembly)
        validation = re.search(
            r"^          node --input-type=module -e '\n.*?^          ' \"\$PWD/dist/stage/battuta\"$",
            workflow, re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(validation)
        snapshots = []
        for _ in range(2):
            with tempfile.TemporaryDirectory(dir=self.root) as directory:
                work = Path(directory)
                stage = work / "dist/stage/battuta"
                for role in ("pm", "tl"):
                    skill_catalog(stage, role)
                for source in (stage / "skills-hub").iterdir():
                    (source / "LICENSE").write_text("Required notice")
                command = textwrap.dedent(assembly.group()).replace("node packaging/stage-skills.mjs", f"node {ROOT / 'packaging/stage-skills.mjs'}")
                result = subprocess.run(["bash", "-euc", command], cwd=work, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse((stage / "skills-hub").exists())
                (stage / "bin").mkdir()
                shutil.copyfile(ROOT / "packaging/shared-resources.mjs", stage / "bin/shared-resources.mjs")
                shutil.copytree(ROOT / "bot-setup", stage / "bot-setup")
                moved = work / "relocated"
                stage.rename(moved)
                for role in ("pm", "tl"):
                    bot = moved / f"bots/{role}-bot"
                    skills = bot / ".pi/skills"
                    names = json.loads((bot / "skills.json").read_text())["skills"]
                    self.assertEqual({p.name for p in skills.iterdir()}, set(names))
                    for name in names:
                        self.assertEqual((skills / name / "references/tools.md").read_text(), f"{name} tools")
                        self.assertEqual((skills / name / "LICENSE").read_text(), "Required notice")
                    self.assertFalse(any(p.is_symlink() for p in skills.rglob("*")))
                command = textwrap.dedent(validation.group()).replace('"$PWD/dist/stage/battuta"', '"$BUNDLE_ROOT"')
                result = subprocess.run(["bash", "-euc", command], env={**os.environ, "BUNDLE_ROOT": str(moved)}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                snapshots.append({str(p.relative_to(moved)): p.read_bytes() for p in moved.rglob("*") if p.is_file()})
        self.assertEqual(snapshots[0], snapshots[1])

    def test_extraction_stops_on_visible_or_hidden_existing_content(self):
        guide = (ROOT / "RELEASE.md").read_text()
        commands = guide.split("```sh\nset -eu\n", 1)[1].split("tar -xzf", 1)[0]
        for content in (None, "existing", ".private", "\n"):
            with self.subTest(content=content), tempfile.TemporaryDirectory(dir=self.root) as directory:
                target = Path(directory) / "apps/battuta"
                target.mkdir(parents=True)
                if content:
                    (target / content).write_text("preserve")
                command = "set -eu\n" + commands + "\nprintf extraction-reached\n"
                result = subprocess.run(["bash", "-c", command], env={**os.environ, "HOME": directory}, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, content is None)
                self.assertEqual("extraction-reached" in result.stdout, content is None)
                if content:
                    self.assertTrue(result.stderr)
                    self.assertEqual((target / content).read_text(), "preserve")

    @unittest.skipIf(os.geteuid() == 0, "root bypasses directory read permissions")
    def test_extraction_stops_if_target_cannot_be_inspected(self):
        guide = (ROOT / "RELEASE.md").read_text()
        commands = guide.split("```sh\nset -eu\n", 1)[1].split("tar -xzf", 1)[0]
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            target = Path(directory) / "apps/battuta"
            target.mkdir(parents=True)
            target.chmod(0o300)
            try:
                result = subprocess.run(["bash", "-c", "set -eu\n" + commands + "\nprintf extraction-reached\n"], env={**os.environ, "HOME": directory}, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("extraction-reached", result.stdout)
            finally:
                target.chmod(0o700)

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
