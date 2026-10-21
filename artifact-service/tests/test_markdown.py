from test_http import HttpFixture


class MarkdownTests(HttpFixture):
    def test_markdown_rendering_is_live_and_images_use_allowlist(self):
        (self.source / "report.md").write_text('# Report\n\n![Chart](chart.png)\n\n<script>alert("x")</script>\n\n[bad](javascript:alert(1))')
        (self.source / "chart.png").write_bytes(b"extension is trusted")
        self.registry.replace_files("demo", source_root=str(self.source), entry_path="report.md", format="markdown",
                                    files={"report.md": "text/markdown", "chart.png": "image/png"})
        client = self.client()
        response = client.get("/artifacts/a/demo/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("<h1>Report</h1>", response.text)
        self.assertIn('src="chart.png"', response.text)
        self.assertNotIn('<script>alert("x")</script>', response.text)
        self.assertNotIn('href="javascript:', response.text)
        self.assertEqual(client.get("/artifacts/a/demo/chart.png").status_code, 200)
        self.assertEqual(client.get("/artifacts/a/demo/secret.txt").status_code, 404)
        (self.source / "report.md").write_text("# Changed")
        self.assertIn("<h1>Changed</h1>", client.get("/artifacts/a/demo/report.md").text)

    def test_nested_entry_redirect_preserves_relative_asset_resolution(self):
        (self.source / "js/report.md").write_text("# Nested")
        self.registry.replace_files("demo", source_root=str(self.source), entry_path="js/report.md", format="markdown",
                                    files={"js/report.md": "text/markdown"})
        response = self.client().get("/artifacts/a/demo/", follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "/artifacts/a/demo/js/report.md")

    def test_unreadable_markdown_encoding_returns_generic_error(self):
        (self.source / "report.md").write_bytes(b"\xff\xfe")
        self.registry.replace_files("demo", source_root=str(self.source), entry_path="report.md", format="markdown",
                                    files={"report.md": "text/markdown"})
        response = self.client().get("/artifacts/a/demo/")
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(str(self.source), response.text)
