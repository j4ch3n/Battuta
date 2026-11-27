"""Generated bot discovery paths stay out of Git (real, hermetic git)."""

from pathlib import Path
import shutil

import pytest

from hermetic_git import run_git

pytestmark = [pytest.mark.integration, pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")]


@pytest.mark.parametrize("role", ["cos", "manager"])
def test_generated_discovery_paths_are_git_ignored(tmp_path, role):
    root = Path(__file__).resolve().parents[4]
    (tmp_path / ".gitignore").write_text((root / f"bots/{role}-bot/.gitignore").read_text())
    run_git("init", "-q", cwd=tmp_path, check=True)
    result = run_git("check-ignore", "--stdin", cwd=tmp_path, input=".pi/skills/memory\n.pi/skills/custom\n.pi/mail-sessions/example.jsonl\n.pi/sessions/example.jsonl\n.pi/settings.json\nbot.toml\n", text=True, capture_output=True)
    assert set(result.stdout.splitlines()) == {".pi/skills/memory", ".pi/skills/custom", ".pi/mail-sessions/example.jsonl", ".pi/sessions/example.jsonl", ".pi/settings.json"}
