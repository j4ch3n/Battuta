import json
import sqlite3
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

import pytest

from battuta_artifacts.app import catalog_groups, catalog_project
from battuta_artifacts.palette import project_colour


class Elements(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


def test_index_has_accessible_list_count_and_readable_utc_dates_without_javascript(http):
    with sqlite3.connect(http.db) as db:
        db.execute("UPDATE artifacts SET updated_at='2026-10-21T00:30:00+00:00'")
    response = http.client().get("/artifacts/")
    assert 'id="artifact-count"' in response.text
    assert "1 work" in response.text
    assert 'datetime="2026-10-21T00:30:00+00:00"' in response.text
    assert "21 Oct 2026" in response.text

    markup = Elements()
    markup.feed(response.text)
    assert any(tag == "ul" and attrs.get("id") == "artifacts" and attrs.get("role") == "list"
               for tag, attrs in markup.elements)
    assert any(tag == "li" and attrs.get("data-slug") == "demo" for tag, attrs in markup.elements)
    assert not any(tag in ("table", "style") for tag, _ in markup.elements)
    assert any(tag == "link" and attrs.get("href") == "/artifacts/catalog.css" for tag, attrs in markup.elements)


def test_project_disclosures_sort_without_javascript_and_preserve_destinations(http):
    base = http.registry.get("demo")
    rows = [
        {**base, "slug": "zeta-work", "project": "zeta"},
        {**base, "slug": "undated-z", "project": "Alpha", "updated_at": None},
        {**base, "slug": "newest", "project": "Alpha", "updated_at": "2026-10-22T00:00:00Z"},
        {**base, "slug": "undated-a", "project": "Alpha", "updated_at": "bad"},
        {**base, "slug": "tie-z", "project": "Alpha", "updated_at": "2026-10-21T00:30:00Z"},
        {**base, "slug": "tie-a", "project": "Alpha", "updated_at": "2026-10-21T01:30:00+01:00"},
        {**base, "slug": "unassigned", "project": None, "updated_at": None},
    ]
    with patch("battuta_artifacts.app.Registry.list", return_value=rows):
        client = http.client()
        response = client.get("/artifacts/")
        payload = client.get("/artifacts/catalog").json()
    assert response.status_code == 200
    assert response.text.count('class="project"') == 4  # Includes inert template.
    assert 'class="project open"' not in response.text
    # Beyond the two newest works, the rest are marked for the deck; the HTML still contains them all.
    assert 'class="artifact extra" data-slug="tie-z"' in response.text
    assert 'class="artifact" data-slug="tie-a"' in response.text
    assert payload["artifacts"][0]["colour"] == project_colour("zeta")
    assert next(item for item in payload["artifacts"] if item["slug"] == "unassigned")["colour"] == project_colour(None)
    assert "Date unavailable" in response.text
    assert str(http.source) not in json.dumps(payload)
    assert payload["artifacts"][0]["project"] == "zeta"
    assert 'href="/artifacts/a/newest/"' in response.text
    groups = catalog_groups(payload["artifacts"])
    assert [group["name"] for group in groups] == ["Alpha", "Unassigned", "zeta"]
    assert [item["slug"] for item in groups[0]["artifacts"]] == ["newest", "tie-a", "tie-z", "undated-a", "undated-z"]
    # Actual no-JavaScript markup follows the same order, not just helper output.
    assert response.text.index('data-project="Alpha"') < response.text.index('data-project="zeta"')
    positions = [response.text.index(f'data-slug="{slug}"') for slug in
                 ["newest", "tie-a", "tie-z", "undated-a", "undated-z"]]
    assert positions == sorted(positions)


def test_project_labels_use_explicit_metadata_then_canonical_ownership_only(http):
    home = Path.home()
    legacy = {"source_root": str(home / ".battuta/projects/synthetic/artifacts/report"), "project": None}
    assert catalog_project(legacy) == "synthetic"
    assert catalog_project({**legacy, "project": "Explicit"}) == "Explicit"
    assert catalog_project({"source_root": str(http.source), "project": None}) is None
    assert catalog_project({"source_root": str(home / ".battuta/projects"), "project": None}) is None


def test_project_names_are_escaped_and_do_not_collide_with_unassigned(http):
    base = http.registry.get("demo")
    with patch("battuta_artifacts.app.Registry.list", return_value=[
        {**base, "project": '<script>bad</script>'},
        {**base, "slug": "named", "project": "Unassigned"},
        {**base, "slug": "missing", "project": None},
    ]):
        response = http.client().get("/artifacts/")
    assert "&lt;script&gt;bad&lt;/script&gt;" in response.text
    assert "<script>bad</script>" not in response.text
    assert 'data-project="Unassigned"' in response.text
    assert 'data-slug="missing"' in response.text


@pytest.mark.parametrize(
    ("path", "media"),
    [("catalog.css", "text/css"), ("theme.css", "text/css"), ("fonts/gabarito-latin.woff2", "font/woff2")],
    ids=["catalog-stylesheet", "theme-stylesheet", "font"],
)
def test_packaged_stylesheet_and_fonts_are_served(http, path, media):
    response = http.client().get(f"/artifacts/{path}")

    assert response.status_code == 200
    assert media in response.headers["content-type"]
    assert response.content
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("path", ["fonts/Gabarito-OFL.txt", "fonts/inter-latin.woff2", "assets/../registry.py"],
                         ids=["font-license", "removed-font", "package-source"])
def test_unlisted_packaged_assets_are_not_served(http, path):
    assert http.client().get(f"/artifacts/{path}").status_code == 404


def test_catalog_reads_latest_rows_and_hides_source_paths(http):
    client = http.client()
    response = client.get("/artifacts/")
    assert response.status_code == 200
    assert "Demo" in response.text
    assert "Description" in response.text
    assert '/artifacts/a/demo/' in response.text
    assert str(http.source) not in response.text
    assert response.headers["cache-control"] == "no-store"
    http.registry.update_metadata("demo", title='<script>alert("x")</script>')
    response = client.get("/artifacts/")
    assert "&lt;script&gt;" in response.text
    assert '<script>alert("x")</script>' not in response.text
    payload = client.get("/artifacts/catalog").json()
    assert "source_root" not in json.dumps(payload)
    assert "entry_path" not in json.dumps(payload)
    assert payload["artifacts"][0]["slug"] == "demo"
    http.registry.deregister("demo")
    assert "No artifacts registered" in client.get("/artifacts/").text
    assert client.get("/artifacts/catalog").json() == {"artifacts": []}
