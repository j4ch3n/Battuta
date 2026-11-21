"""Private runtime state stays out of Git discovery and release archives."""

from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest

from hermetic_git import run_git

ROOT = Path(__file__).resolve().parents[3]


class MemoryPrivacyTests(unittest.TestCase):
    def test_private_state_is_ignored_and_force_tracked_state_is_not_archived(self):
        private = [
            "bots/cos-bot/.pi/ME.md", "bots/manager-bot/.pi/ME.md",
            "bots/cos-bot/.pi/ME.md.id.tmp", "bots/cos-bot/.pi/ME.md.lock",
            "bots/AGENTS_personal.md", "memory.db", "memory.db-wal",
            "memory.db.queue/job.job.json", "memory.db.queue/job.state.json",
            "capture-queue/cos/state.json", "onnx_models/all-MiniLM-L6-v2/model.onnx",
        ]
        public = ["skills-hub/research/SKILL.md", "docs/memory-tools.md"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_git("init", "-q", str(root), cwd=root, check=True)
            for name in (".gitignore", ".gitattributes", "bots/cos-bot/.gitignore", "bots/manager-bot/.gitignore"):
                source = ROOT / name
                if source.exists():
                    (root / name).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, root / name)
            for name in private + public:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture")
            ignored = run_git("check-ignore", "--stdin", cwd=root, input="\n".join(private + public), text=True, capture_output=True)
            self.assertEqual(set(ignored.stdout.splitlines()), set(private))
            run_git("add", "-f", ".", cwd=root, check=True)
            run_git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture", cwd=root, check=True)
            archive = root / "release.tar"
            run_git("archive", "HEAD", "-o", str(archive), cwd=root, check=True)
            with tarfile.open(archive) as contents:
                names = set(contents.getnames())
            self.assertFalse(names.intersection(private))
            self.assertTrue(set(public).issubset(names))
