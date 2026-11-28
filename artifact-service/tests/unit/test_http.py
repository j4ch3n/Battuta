import os
import re
import sqlite3
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from battuta_artifacts.app import create_app
from battuta_artifacts.registry import Registry, SchemaError


def test_concurrent_replacement_never_combines_root_and_allowlist_revisions(http):
    # WAL lets the writer commit while the reader retains an older snapshot.
    with sqlite3.connect(http.db) as db:
        db.execute("PRAGMA journal_mode=WAL")
    (http.source / "private.js").write_text("never registered from this root")
    new_root = http.root / "new-source"
    new_root.mkdir()
    (new_root / "index.html").write_text("New entry")
    (new_root / "private.js").write_text("explicitly published from new root")
    find = Registry._find
    replace_once = [True]

    def replace_after_metadata(db, slug):
        item = find(db, slug)
        if replace_once[0]:
            replace_once[0] = False
            http.registry.replace_files("demo", source_root=str(new_root), entry_path="index.html", format="html",
                                        files={"index.html": "text/html", "private.js": "text/javascript"})
        return item

    client = http.client()
    # Interleave real registry replacement exactly between metadata and files.
    with patch.object(Registry, "_find", side_effect=replace_after_metadata):
        response = client.get("/artifacts/a/demo/private.js")
    assert response.status_code == 404
    assert client.get("/artifacts/a/demo/private.js").text == "explicitly published from new root"


def test_entry_bundle_live_changes_and_deregistration(http):
    client = http.client()
    response = client.get("/artifacts/a/demo", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"].endswith("/demo/")
    response = client.get("/artifacts/a/demo/")
    assert response.status_code == 200
    assert 'src="js/app.js"' in response.text
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    response = client.get("/artifacts/a/demo/js/app.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]
    (http.source / "js/app.js").write_text("changed source")
    assert client.get("/artifacts/a/demo/js/app.js").text == "changed source"
    assert response.headers["cache-control"] == "no-store"
    http.registry.deregister("demo")
    assert client.get("/artifacts/a/demo/").status_code == 404
    assert (http.source / "index.html").exists()


@pytest.mark.parametrize(
    "path",
    ["secret.txt", "%2e%2e/secret.txt", "%252e%252e/secret.txt", "%2Fetc/passwd", "js//app.js",
     "js/%2e%2e/secret.txt", "index.html/", "js%5capp.js"],
    ids=["unlisted", "encoded-parent", "double-encoded-parent", "encoded-absolute", "empty-segment",
         "nested-encoded-parent", "trailing-slash", "encoded-backslash"],
)
def test_no_unlisted_or_traversal_or_absolute_path_access(http, path):
    response = http.client().get(f"/artifacts/a/demo/{path}")

    assert response.status_code == 404
    assert str(http.source) not in response.text


def assert_error_page(response, heading, *absent):
    assert response.status_code == 404
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert heading in response.text
    assert '<link rel="stylesheet" href="/artifacts/theme.css"' in response.text
    assert 'href="/artifacts/"' in response.text
    assert "<script" not in response.text
    for text in absent:
        assert text not in response.text


@pytest.mark.parametrize(
    "url",
    ["/artifacts/a/demo/nope.txt", "/artifacts/a/missing/", "/artifacts/a/demo/secret.txt", "/artifacts/111",
     "/elsewhere", "/artifacts/fonts/inter-latin.woff2"],
    ids=["unknown-file", "unknown-artifact", "unlisted-file", "unknown-route", "outside-artifacts", "unknown-font"],
)
def test_unknown_path_returns_styled_404_page(http, url):
    assert_error_page(http.client().get(url), "Nothing here to read", "nope", "private", str(http.source))


@pytest.mark.parametrize("path", [".env", "sub/.git/config", ".git/config", "sub/.hidden"],
                         ids=["dotfile", "nested-git", "git", "nested-dotfile"])
@pytest.mark.parametrize("slug", ["demo", "leaky", "missing"], ids=["plain-artifact", "leaky-artifact", "unknown-artifact"])
def test_hidden_request_paths_return_warning_page_without_bytes(http, slug, path):
    (http.source / ".env").write_text("SECRET-ENV")
    (http.source / "sub/.git").mkdir(parents=True)
    (http.source / "sub/.git/config").write_text("SECRET-GIT")
    http.registry.register(slug="leaky", title="Leaky", description="Hidden files registered", status="published",
                           source_root=str(http.source), entry_path="index.html", format="html",
                           files={"index.html": "text/html", ".env": "text/plain", "sub/.git/config": "text/plain"})

    assert_error_page(http.client().get(f"/artifacts/a/{slug}/{path}"), "Hidden files stay hidden", "SECRET", path)


def test_front_page_title_has_no_divider(http):
    client = http.client()
    assert "<hr" not in client.get("/artifacts/").text
    css = client.get("/artifacts/catalog.css")
    assert css.status_code == 200
    hero = re.search(r"^\.hero \{(.*?)\}", css.text, re.DOTALL | re.MULTILINE)
    assert hero is not None
    assert "border-block-end" not in hero.group(1)


def test_missing_file_and_post_registration_symlinks_are_not_served(http):
    client = http.client()
    script = http.source / "js/app.js"
    script.unlink()
    assert client.get("/artifacts/a/demo/js/app.js").status_code == 404
    script.symlink_to(http.source / "secret.txt")
    assert client.get("/artifacts/a/demo/js/app.js").status_code == 404
    script.unlink()
    (http.source / "js").rmdir()
    outside = http.root / "outside"
    outside.mkdir()
    (outside / "app.js").write_text("secret")
    (http.source / "js").symlink_to(outside, target_is_directory=True)
    assert client.get("/artifacts/a/demo/js/app.js").status_code == 404


def test_replaced_root_and_fifo_are_not_served(http):
    client = http.client()
    moved = http.root / "moved"
    http.source.rename(moved)
    http.source.symlink_to(moved, target_is_directory=True)
    assert client.get("/artifacts/a/demo/").status_code == 404
    http.source.unlink()
    moved.rename(http.source)
    script = http.source / "js/app.js"
    script.unlink()
    os.mkfifo(script)
    assert client.get("/artifacts/a/demo/js/app.js").status_code == 404


def test_startup_never_creates_or_upgrades_registry(http):
    missing = http.root / "missing.sqlite3"
    with pytest.raises(SchemaError, match="setup"):
        with TestClient(create_app(missing)):
            pass
    assert not missing.exists()
    before = http.db.read_bytes()
    with TestClient(create_app(http.db)) as client:
        assert client.get("/artifacts/a/demo/").status_code == 200
    assert http.db.read_bytes() == before
