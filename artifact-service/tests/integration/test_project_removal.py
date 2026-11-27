"""Project removal keeps other projects' artifacts and moves the project's files to the Trash."""

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


def test_removal_preserves_project_files_and_unrelated_artifacts(run, cli, env, tmp_path):
    home = Path(env["HOME"])
    run("battuta-project", "init", "atlas")
    root = home / ".battuta/projects/atlas"
    (root / "draft.md").write_text("preserved")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "other.md").write_text("# Other")
    cli("add-file", "--type", "markdown", "--file", str(root / "draft.md"), "--slug", "atlas-report",
        "--title", "Report", "--description", "Report")
    cli("add-file", "--type", "markdown", "--file", str(elsewhere / "other.md"), "--slug", "other",
        "--title", "Other", "--description", "Other")

    run("battuta-project", "remove", "atlas")

    assert not root.exists()
    assert [item["slug"] for item in cli("list")["artifacts"]] == ["other"]
    assert next((home / ".Trash").glob("atlas-*/atlas/draft.md")).read_text() == "preserved"
    assert json.loads(run("battuta-project", "list", "--json"))["projects"] == []
