"""Project removal keeps other projects' artifacts and moves the project's files to the Trash."""

import json
from pathlib import Path

import pytest

from battuta_artifacts.registry import Registry

pytestmark = pytest.mark.integration


def test_removal_preserves_project_files_and_unrelated_artifacts(run, env):
    home = Path(env["HOME"])
    run("battuta-project", "init", "atlas")
    root = home / ".battuta/projects/atlas"
    (root / ".draft").write_text("preserved")
    db = Path(env["BATTUTA_ARTIFACT_DB"])
    run("battuta-artifact", "setup")
    store = Registry(db)
    store.register(slug="atlas-report", title="Report", description="Report", source_root=str(root),
                   entry_path=".draft", format="markdown", files={".draft": "text/markdown"}, status="published")
    store.register(slug="other", title="Other", description="Other", source_root="/unrelated",
                   entry_path="index.html", format="html", files={"index.html": "text/html"})

    run("battuta-project", "remove", "atlas")

    assert not root.exists()
    assert [item["slug"] for item in store.list()] == ["other"]
    assert next((home / ".Trash").glob("atlas-*/atlas/.draft")).read_text() == "preserved"
    assert json.loads(run("battuta-project", "list", "--json"))["projects"] == []
