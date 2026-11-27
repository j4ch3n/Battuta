"""Private runtime state stays out of Git discovery and release archives."""

from pathlib import Path
import shutil
import tarfile

import pytest

from hermetic_git import requires_git, run_git

pytestmark = [pytest.mark.integration, requires_git]

ROOT = Path(__file__).resolve().parents[4]


def test_private_state_is_ignored_and_force_tracked_state_is_not_archived(tmp_path):
    private = [
        "bots/cos-bot/.pi/ME.md", "bots/manager-bot/.pi/ME.md",
        "bots/cos-bot/.pi/ME.md.id.tmp", "bots/cos-bot/.pi/ME.md.lock",
        "bots/AGENTS_personal.md", "memory.db", "memory.db-wal",
        "memory.db.queue/job.job.json", "memory.db.queue/job.state.json",
        "capture-queue/cos/state.json", "onnx_models/all-MiniLM-L6-v2/model.onnx",
    ]
    public = ["skills-hub/research/SKILL.md", "docs/memory-tools.md"]
    run_git("init", "-q", str(tmp_path), cwd=tmp_path, check=True)
    for name in (".gitignore", ".gitattributes", "bots/cos-bot/.gitignore", "bots/manager-bot/.gitignore"):
        source = ROOT / name
        if source.exists():
            (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, tmp_path / name)
    for name in private + public:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture")
    ignored = run_git("check-ignore", "--stdin", cwd=tmp_path, input="\n".join(private + public), text=True, capture_output=True)
    assert set(ignored.stdout.splitlines()) == set(private)
    run_git("add", "-f", ".", cwd=tmp_path, check=True)
    run_git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture", cwd=tmp_path, check=True)
    archive = tmp_path / "release.tar"
    run_git("archive", "HEAD", "-o", str(archive), cwd=tmp_path, check=True)
    with tarfile.open(archive) as contents:
        names = set(contents.getnames())
    assert not names.intersection(private)
    assert set(public).issubset(names)
