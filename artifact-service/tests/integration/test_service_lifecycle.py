"""Catalog behaviour beyond the publishing scenarios: live edits, SSE refresh, Markdown, narrowing and deregistration."""

import json
from pathlib import Path
from urllib.request import urlopen

import pytest

pytestmark = pytest.mark.integration

PROJECT = "procurement"


@pytest.fixture
def source(run, cli):
    """A draft HTML artifact "demo" with an app.js, registered but not yet published."""
    run("battuta-project", "init", PROJECT)
    directory = Path(cli("init", "demo", "--project", PROJECT, "--title", "Demo", "--description", "Walkthrough",
                         "--vendor", "mermaid")["directory"])
    (directory / "index.html").write_text('<script src="app.js"></script>')
    (directory / "app.js").write_text("console.log('demo')")
    cli("replace-files", "demo", "--root", str(directory), "--entry", "index.html", "--file", "app.js")
    return directory


@pytest.fixture
def published(cli, source):
    cli("publish", "--project", PROJECT, "--artifact", "demo")
    return source


def test_draft_is_not_listed_or_served_until_published(cli, get, source):
    assert json.loads(get("/artifacts/catalog")) == {"artifacts": []}
    assert get("/artifacts/a/demo/app.js") == 404
    cli("publish", "--project", PROJECT, "--artifact", "demo")
    assert "Demo" in get("/artifacts/")


def test_edits_are_served_live_and_updates_refresh_open_pages(cli, get, published):
    (published / "app.js").write_text("live edit")
    assert get("/artifacts/a/demo/app.js") == "live edit"

    with urlopen(get.address + "/artifacts/events", timeout=4) as stream:
        def next_event():
            lines = []
            while True:
                line = stream.readline()
                assert line, "SSE connection ended before refresh"
                lines.append(line)
                if not line.strip() and any(b"catalog-changed" in value for value in lines):
                    return b"".join(lines)
        assert b"refresh" in next_event()
        cli("update", "demo", "--description", "Updated")
        assert b"refresh" in next_event()
    assert "Updated" in get("/artifacts/")


def test_markdown_file_is_rendered_without_serving_its_neighbours(cli, get, published):
    (published / "report.md").write_text("# Report\n\n![Image](chart.png)")
    (published / "chart.png").write_bytes(b"trusted extension")
    cli("add-file", "--type", "markdown", "--file", str(published / "report.md"), "--slug", "notes",
        "--title", "Research", "--description", "Existing Markdown")
    assert "<h1>Report</h1>" in get("/artifacts/a/notes/")
    assert get("/artifacts/a/notes/chart.png") == 404


def test_replacing_files_narrows_what_is_served(cli, get, published):
    (published / "secret.txt").write_text("kept out")
    cli("replace-files", "demo", "--root", str(published), "--entry", "index.html")
    assert get("/artifacts/a/demo/app.js") == 404


def test_deregistering_withdraws_artifacts_but_keeps_source_files(cli, get, published):
    (published / "report.md").write_text("# Report")
    cli("add-file", "--type", "markdown", "--file", str(published / "report.md"), "--slug", "notes",
        "--title", "Research", "--description", "Existing Markdown")
    cli("deregister", "demo")
    cli("deregister", "notes")
    assert json.loads(get("/artifacts/catalog")) == {"artifacts": []}
    assert get("/artifacts/a/demo/") == 404
    assert (published / "index.html").exists()
