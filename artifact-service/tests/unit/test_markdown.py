def test_markdown_rendering_is_live_and_images_use_allowlist(http):
    (http.source / "report.md").write_text('# Report\n\n![Chart](chart.png)\n\n<script>alert("x")</script>\n\n[bad](javascript:alert(1))')
    (http.source / "chart.png").write_bytes(b"extension is trusted")
    http.registry.replace_files("demo", source_root=str(http.source), entry_path="report.md", format="markdown",
                                files={"report.md": "text/markdown", "chart.png": "image/png"})
    client = http.client()

    response = client.get("/artifacts/a/demo/")

    assert response.status_code == 200
    assert "<h1>Report</h1>" in response.text
    assert 'src="chart.png"' in response.text
    assert '<script>alert("x")</script>' not in response.text
    assert 'href="javascript:' not in response.text
    assert client.get("/artifacts/a/demo/chart.png").status_code == 200
    assert client.get("/artifacts/a/demo/secret.txt").status_code == 404
    (http.source / "report.md").write_text("# Changed")
    assert "<h1>Changed</h1>" in client.get("/artifacts/a/demo/report.md").text


def test_nested_entry_redirect_preserves_relative_asset_resolution(http):
    (http.source / "js/report.md").write_text("# Nested")
    http.registry.replace_files("demo", source_root=str(http.source), entry_path="js/report.md", format="markdown",
                                files={"js/report.md": "text/markdown"})

    response = http.client().get("/artifacts/a/demo/", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/artifacts/a/demo/js/report.md"


def test_unreadable_markdown_encoding_returns_generic_error(http):
    (http.source / "report.md").write_bytes(b"\xff\xfe")
    http.registry.replace_files("demo", source_root=str(http.source), entry_path="report.md", format="markdown",
                                files={"report.md": "text/markdown"})

    response = http.client().get("/artifacts/a/demo/")

    assert response.status_code == 422
    assert str(http.source) not in response.text
