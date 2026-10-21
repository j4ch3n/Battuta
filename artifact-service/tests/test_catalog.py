import json

from test_http import HttpFixture


class CatalogTests(HttpFixture):
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
