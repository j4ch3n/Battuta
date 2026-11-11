import json
import sqlite3
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

from battuta_artifacts.app import catalog_groups, catalog_project

from test_http import HttpFixture


class CatalogTests(HttpFixture):
    def test_index_has_accessible_list_count_and_readable_utc_dates_without_javascript(self):
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE artifacts SET updated_at='2026-10-21T00:30:00+00:00'")
        response = self.client().get("/artifacts/")
        self.assertIn('id="artifact-count"', response.text)
        self.assertIn("1 work", response.text)
        self.assertIn('datetime="2026-10-21T00:30:00+00:00"', response.text)
        self.assertIn("21 Oct 2026", response.text)

        class Elements(HTMLParser):
            def __init__(self):
                super().__init__()
                self.elements = []

            def handle_starttag(self, tag, attrs):
                self.elements.append((tag, dict(attrs)))

        markup = Elements()
        markup.feed(response.text)
        self.assertTrue(any(tag == "ul" and attrs.get("id") == "artifacts" and attrs.get("role") == "list"
                            for tag, attrs in markup.elements))
        self.assertTrue(any(tag == "li" and attrs.get("data-slug") == "demo" for tag, attrs in markup.elements))
        self.assertFalse(any(tag in ("table", "style") for tag, _ in markup.elements))
        self.assertTrue(any(tag == "link" and attrs.get("href") == "/artifacts/catalog.css" for tag, attrs in markup.elements))

    def test_project_disclosures_sort_without_javascript_and_preserve_destinations(self):
        base = self.registry.get("demo")
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
            client = self.client()
            response = client.get("/artifacts/")
            payload = client.get("/artifacts/catalog").json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text.count('<details class="project-disclosure">'), 4)  # Includes inert template.
        self.assertNotIn("<details class=\"project-disclosure\" open", response.text)
        self.assertIn("Date unavailable", response.text)
        self.assertNotIn(str(self.source), json.dumps(payload))
        self.assertEqual(payload["artifacts"][0]["project"], "zeta")
        self.assertIn('href="/artifacts/a/newest/"', response.text)
        groups = catalog_groups(payload["artifacts"])
        self.assertEqual([group["name"] for group in groups], ["Alpha", "Unassigned", "zeta"])
        self.assertEqual([item["slug"] for item in groups[0]["artifacts"]],
                         ["newest", "tie-a", "tie-z", "undated-a", "undated-z"])
        # Actual no-JavaScript markup follows the same order, not just helper output.
        self.assertLess(response.text.index('data-project="Alpha"'), response.text.index('data-project="zeta"'))
        positions = [response.text.index(f'data-slug="{slug}"') for slug in
                     ["newest", "tie-a", "tie-z", "undated-a", "undated-z"]]
        self.assertEqual(positions, sorted(positions))

    def test_project_labels_use_explicit_metadata_then_canonical_ownership_only(self):
        home = Path.home()
        legacy = {"source_root": str(home / ".battuta/projects/synthetic/artifacts/report"), "project": None}
        self.assertEqual(catalog_project(legacy), "synthetic")
        self.assertEqual(catalog_project({**legacy, "project": "Explicit"}), "Explicit")
        self.assertIsNone(catalog_project({"source_root": str(self.source), "project": None}))
        self.assertIsNone(catalog_project({"source_root": str(home / ".battuta/projects"), "project": None}))

    def test_project_names_are_escaped_and_do_not_collide_with_unassigned(self):
        base = self.registry.get("demo")
        with patch("battuta_artifacts.app.Registry.list", return_value=[
            {**base, "project": '<script>bad</script>'},
            {**base, "slug": "named", "project": "Unassigned"},
            {**base, "slug": "missing", "project": None},
        ]):
            response = self.client().get("/artifacts/")
        self.assertIn("&lt;script&gt;bad&lt;/script&gt;", response.text)
        self.assertNotIn("<script>bad</script>", response.text)
        self.assertIn('data-project="Unassigned"', response.text)
        self.assertIn('data-slug="missing"', response.text)

    def test_packaged_stylesheet_and_font_are_served_without_arbitrary_asset_access(self):
        client = self.client()
        for path, media in [("catalog.css", "text/css"), ("fonts/newsreader-latin.woff2", "font/woff2"),
                            ("fonts/inter-latin.woff2", "font/woff2")]:
            with self.subTest(path=path):
                response = client.get(f"/artifacts/{path}")
                self.assertEqual(response.status_code, 200)
                self.assertIn(media, response.headers["content-type"])
                self.assertTrue(response.content)
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(client.get("/artifacts/fonts/OFL.txt").status_code, 404)
        self.assertEqual(client.get("/artifacts/assets/../registry.py").status_code, 404)

    def test_catalog_reads_latest_rows_and_hides_source_paths(self):
        client = self.client()
        response = client.get("/artifacts/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Demo", response.text)
        self.assertIn("Description", response.text)
        self.assertIn('/artifacts/a/demo/', response.text)
        self.assertNotIn(str(self.source), response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.registry.update_metadata("demo", title='<script>alert("x")</script>')
        response = client.get("/artifacts/")
        self.assertIn("&lt;script&gt;", response.text)
        self.assertNotIn('<script>alert("x")</script>', response.text)
        payload = client.get("/artifacts/catalog").json()
        self.assertNotIn("source_root", json.dumps(payload))
        self.assertNotIn("entry_path", json.dumps(payload))
        self.assertEqual(payload["artifacts"][0]["slug"], "demo")
        self.registry.deregister("demo")
        self.assertIn("No artifacts registered", client.get("/artifacts/").text)
        self.assertEqual(client.get("/artifacts/catalog").json(), {"artifacts": []})
