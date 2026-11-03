"""Packaged configuration validates fixed bundles without the source catalog."""

from itertools import product
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from skill_fixtures import skill_bundle, skill_catalog

ROOT = Path(__file__).resolve().parents[2]


class SharedResourceTests(unittest.TestCase):
    def configure(self, root, bot):
        return subprocess.run([
            "node", "--input-type=module", "-e",
            "const {configureSharedResources} = await import(process.argv[1]); await configureSharedResources(process.argv[2], process.argv[3]);",
            str(ROOT / "packaging/shared-resources.mjs"), str(root), str(bot),
        ], capture_output=True, text=True)

    def prepare(self, root, role):
        skill_bundle(root, role)
        shutil.rmtree(root / "skills-hub")
        (root / "bots/AGENTS_shared.md").write_text("Shared")
        bot = root / f"bots/{role}-bot"
        (bot / "AGENTS_dedicated.md").write_text("Dedicated")
        return bot

    def test_bundled_validation_is_idempotent_without_hub_or_state_changes(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = self.prepare(root, role)
                skills = bot / ".pi/skills"
                before = {str(p.relative_to(skills)): p.read_bytes() for p in skills.rglob("*") if p.is_file()}
                (bot / ".pi/auth.json").write_text("private")
                (bot / ".pi/mail-sessions").mkdir()
                (bot / ".pi/mail-sessions/session.jsonl").write_text("session")
                for _ in range(2):
                    result = self.configure(root, bot)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual({str(p.relative_to(skills)): p.read_bytes() for p in skills.rglob("*") if p.is_file()}, before)
                    self.assertEqual((bot / ".pi/auth.json").read_text(), "private")
                    self.assertEqual((bot / ".pi/mail-sessions/session.jsonl").read_text(), "session")
                    self.assertEqual((bot / "AGENTS.md").read_text(), "Shared\nDedicated")

    def test_invalid_bundles_and_manifest_edits_leave_output_unchanged(self):
        for role, kind in product(("pm", "tl"), ("file", "link", "missing", "added", "removed", "resource-link", "directory-link")):
            with self.subTest(role=role, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = self.prepare(root, role)
                target = bot / ".pi/skills/note-taking"
                if kind == "missing":
                    (target / "SKILL.md").unlink()
                elif kind == "file":
                    shutil.rmtree(target)
                    target.write_text("custom")
                elif kind == "link":
                    target.rename(root / "custom-notes")
                    target.symlink_to(root / "custom-notes")
                elif kind == "resource-link":
                    (root / "private.md").write_text("private")
                    (target / "references/tools.md").unlink()
                    (target / "references/tools.md").symlink_to(root / "private.md")
                elif kind == "directory-link":
                    skills = target.parent
                    skills.rename(root / "linked-skills")
                    skills.symlink_to(root / "linked-skills")
                else:
                    manifest = bot / "skills.json"
                    names = json.loads(manifest.read_text())["skills"]
                    if kind == "added":
                        names.append("unbundled")
                    else:
                        names.remove("note-taking")
                    manifest.write_text(json.dumps({"skills": names}))
                result = self.configure(root, bot)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((bot / "AGENTS.md").exists())
                if kind == "file":
                    self.assertEqual(target.read_text(), "custom")
                elif kind == "link":
                    self.assertEqual(target.readlink(), root / "custom-notes")

    def test_empty_bundle_is_valid(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = self.prepare(root, role)
                (bot / "skills.json").write_text('{"skills":[]}')
                shutil.rmtree(bot / ".pi/skills")
                (bot / ".pi/skills").mkdir()
                result = self.configure(root, bot)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(list((bot / ".pi/skills").iterdir()), [])

    def test_stage_portability_and_resources_and_invalid_selection_preflight(self):
        for valid in (True, False):
            with self.subTest(valid=valid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "stage"
                for role in ("pm", "tl"):
                    skill_catalog(root, role)
                    for source in (root / "skills-hub").iterdir():
                        (source / "LICENSE").write_text("Required notice")
                    resource = root / "skills-hub/memory/references/copy.md"
                    if not resource.exists():
                        resource.symlink_to("tools.md")
                    skills = root / f"bots/{role}-bot/.pi/skills"
                    skills.mkdir(parents=True)
                    (skills / "memory").symlink_to("../../../../skills-hub/memory")
                if not valid:
                    (root / "bots/tl-bot/skills.json").write_text('{"skills":["missing"]}')
                result = subprocess.run(["node", str(ROOT / "packaging/stage-skills.mjs"), str(root)], capture_output=True, text=True)
                if not valid:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertTrue((root / "bots/pm-bot/.pi/skills/memory").is_symlink())
                    continue
                self.assertEqual(result.returncode, 0, result.stderr)
                shutil.rmtree(root / "skills-hub")
                moved = root.with_name("relocated")
                shutil.move(root, moved)
                for role in ("pm", "tl"):
                    bot = moved / f"bots/{role}-bot"
                    names = json.loads((bot / "skills.json").read_text())["skills"]
                    self.assertEqual({p.name for p in (bot / ".pi/skills").iterdir()}, set(names))
                    for name in names:
                        skill = bot / ".pi/skills" / name
                        self.assertFalse(skill.is_symlink())
                        self.assertTrue((skill / "SKILL.md").is_file())
                        self.assertEqual((skill / "references/tools.md").read_text(), f"{name} tools")
                        self.assertEqual((skill / "LICENSE").read_text(), "Required notice")
                    self.assertEqual((bot / ".pi/skills/memory/references/copy.md").read_text(), "memory tools")
                    self.assertFalse((bot / ".pi/skills/memory/references/copy.md").is_symlink())
                    self.assertFalse((bot / ".pi/skills/memory").is_symlink())

    def test_empty_selection_discards_archived_discovery_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for role in ("pm", "tl"):
                skill_catalog(root, role)
                bot = root / f"bots/{role}-bot"
                (bot / "skills.json").write_text('{"skills":[]}')
                discovery = bot / ".pi/skills"
                discovery.mkdir(parents=True)
                (discovery / "memory").symlink_to("../../../../skills-hub/memory")
                (bot / ".pi/auth.json").write_text("private")
            result = subprocess.run(["node", str(ROOT / "packaging/stage-skills.mjs"), str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for role in ("pm", "tl"):
                pi = root / f"bots/{role}-bot/.pi"
                self.assertEqual(list((pi / "skills").iterdir()), [])
                self.assertEqual((pi / "auth.json").read_text(), "private")
