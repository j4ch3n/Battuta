import json
import sqlite3
from html.parser import HTMLParser

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

    def test_packaged_stylesheet_and_font_are_served_without_arbitrary_asset_access(self):
        client = self.client()
        for path, media in [("catalog.css", "text/css"), ("fonts/public-sans-latin.woff2", "font/woff2")]:
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
