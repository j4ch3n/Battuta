import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from battuta_artifacts.app import create_app


def test_publication_allows_only_the_generated_runtime_files(bundle):
    assert bundle.init("--vendor", "live-diagram").exit_code == 0

    result = bundle.publish()

    assert result.exit_code == 0, result.output
    published = json.loads(result.output)["artifact"]
    assert set(published["files"]) == {"index.html", "styles.css", "index.js", "vendor/mermaid.css",
                                       "vendor/live-diagram.css"}
    with TestClient(create_app(bundle.store.path)) as client:
        for path in published["files"]:
            assert client.get("/artifacts/a/sizing/" + path).status_code == 200, path
        for path in ("NOTICE.txt", "vendor/importmap.json"):
            assert client.get("/artifacts/a/sizing/" + path).status_code == 404, path


def test_draft_is_inaccessible_until_explicit_publication(bundle):
    assert bundle.init("--vendor", "mermaid").exit_code == 0
    item = bundle.store.get("sizing")
    with TestClient(create_app(bundle.store.path)) as client:
        assert client.get("/artifacts/catalog").json() == {"artifacts": []}
        assert "VRAM" not in client.get("/artifacts/").text
        with patch("battuta_artifacts.app.open_source", side_effect=AssertionError("Draft files must not open")):
            for path in ["", *item["files"]]:
                draft, unknown = client.get("/artifacts/a/sizing/" + path), client.get("/artifacts/a/unknown/")
                assert (draft.status_code, draft.text) == (unknown.status_code, unknown.text)
        assert json.loads(bundle.command("show", "sizing").output)["artifact"]["status"] == "draft"
        assert json.loads(bundle.command("list").output)["artifacts"][0]["status"] == "draft"
        directory = bundle.directory
        (directory / "index.html").write_text('<h1>Authored report</h1><script src="extra.js"></script>')
        (directory / "extra.js").write_text("window.example = true;")
        (directory / "secret.txt").write_text("private")
        result = bundle.publish("--file", "extra.js", "--expected-revision", "1")
        assert result.exit_code == 0, result.output
        published = json.loads(result.output)["artifact"]
        assert (published["id"], published["revision"], published["status"]) == (item["id"], 2, "published")
        assert bundle.publish().exit_code == 0
        assert bundle.store.get("sizing")["revision"] == 2
        assert bundle.publish("--expected-revision", "1").exit_code == 4
        assert "Authored report" in client.get("/artifacts/a/sizing/").text
        for path in published["files"]:
            assert client.get("/artifacts/a/sizing/" + path).status_code == 200, path
        for path in ("secret.txt", "file-meta.json", "vendor/importmap.json", "NOTICE.txt"):
            assert client.get("/artifacts/a/sizing/" + path).status_code == 404
        assert len(client.get("/artifacts/catalog").json()["artifacts"]) == 1
        assert bundle.command("deregister", "sizing").exit_code == 0
        assert client.get("/artifacts/a/sizing/").status_code == 404
        assert (directory / "index.html").exists()


def test_failed_publish_and_complete_file_replacement_preserve_draft(bundle):
    bundle.init("--vendor", "mermaid")
    directory = bundle.directory
    (directory / "styles.css").unlink()
    assert bundle.publish().exit_code == 2
    assert bundle.store.get("sizing")["status"] == "draft"
    (directory / "custom.css").write_text("body {color: blue}")
    result = bundle.command("replace-files", "sizing", "--root", str(directory), "--entry", "index.html",
                            "--file", "custom.css")
    assert result.exit_code == 0, result.output
    assert bundle.store.get("sizing")["status"] == "draft"
    assert set(bundle.store.get("sizing")["files"]) == {"index.html", "custom.css"}
    assert bundle.publish("--file", "../secret").exit_code == 2
    assert bundle.store.get("sizing")["status"] == "draft"
    assert bundle.publish().exit_code == 0


def test_missing_public_url_does_not_publish_as_failed_command(bundle):
    bundle.init("--vendor", "mermaid")
    result = bundle.command("publish", "--project", "procurement", "--artifact", "sizing")
    assert result.exit_code == 2
    assert bundle.store.get("sizing")["status"] == "draft"
