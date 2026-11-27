"""Catalog behaviour beyond the publishing scenarios: live edits, SSE refresh, Markdown, narrowing and deregistration."""

import json
from pathlib import Path
from urllib.request import urlopen

import pytest

pytestmark = pytest.mark.integration


def test_published_bundle_stays_live_and_withdraws_on_deregister(run, cli, get, tmp_path):
    initialized = cli("init", "demo", "--project", _project(run), "--title", "Demo", "--description", "Walkthrough",
                      "--vendor", "mermaid")
    source = Path(initialized["directory"])
    (source / "index.html").write_text('<script src="app.js"></script>')
    (source / "app.js").write_text("console.log('demo')")
    cli("replace-files", "demo", "--root", str(source), "--entry", "index.html", "--file", "app.js")

    assert json.loads(get("/artifacts/catalog")) == {"artifacts": []}
    assert get("/artifacts/a/demo/app.js") == 404
    cli("publish", "--project", "procurement", "--artifact", "demo")
    assert "Demo" in get("/artifacts/")

    (source / "app.js").write_text("live edit")
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

    (source / "report.md").write_text("# Report\n\n![Image](chart.png)")
    (source / "chart.png").write_bytes(b"trusted extension")
    cli("add-file", "--type", "markdown", "--file", str(source / "report.md"), "--slug", "notes",
        "--title", "Research", "--description", "Existing Markdown")
    assert "<h1>Report</h1>" in get("/artifacts/a/notes/")
    assert get("/artifacts/a/notes/chart.png") == 404

    (source / "secret.txt").write_text("kept out")
    cli("replace-files", "demo", "--root", str(source), "--entry", "index.html")
    assert get("/artifacts/a/demo/app.js") == 404

    cli("deregister", "demo")
    cli("deregister", "notes")
    assert json.loads(get("/artifacts/catalog")) == {"artifacts": []}
    assert get("/artifacts/a/demo/") == 404
    assert (source / "index.html").exists()


def _project(run):
    run("battuta-project", "init", "procurement")
    return "procurement"
