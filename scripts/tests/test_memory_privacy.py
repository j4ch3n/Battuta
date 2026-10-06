"""Private runtime state stays out of Git discovery and release archives."""

from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class MemoryPrivacyTests(unittest.TestCase):
    def test_private_state_is_ignored_and_force_tracked_state_is_not_archived(self):
        private = [
            "bots/pm-bot/.pi/ME.md", "bots/tl-bot/.pi/ME.md",
            "bots/pm-bot/.pi/ME.md.id.tmp", "bots/pm-bot/.pi/ME.md.lock",
            "bots/AGENTS_personal.md", "memory.db", "memory.db-wal",
            "memory.db.queue/job.job.json", "memory.db.queue/job.state.json",
        ]
        public = ["shared-skills/memory/references/ME.template.md", "shared-skills/memory/references/profile-rewrite-prompt.md"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            for name in (".gitignore", ".gitattributes"):
                source = ROOT / name
                if source.exists():
                    shutil.copyfile(source, root / name)
            for name in private + public:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture")
            ignored = subprocess.run(["git", "check-ignore", "--stdin"], cwd=root, input="\n".join(private + public), text=True, capture_output=True)
            self.assertEqual(set(ignored.stdout.splitlines()), set(private))
            subprocess.run(["git", "add", "-f", "."], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], cwd=root, check=True)
            archive = root / "release.tar"
            subprocess.run(["git", "archive", "HEAD", "-o", str(archive)], cwd=root, check=True)
            with tarfile.open(archive) as contents:
                names = set(contents.getnames())
            self.assertFalse(names.intersection(private))
            self.assertTrue(set(public).issubset(names))
