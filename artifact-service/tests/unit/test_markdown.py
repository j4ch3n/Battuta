import pytest

from battuta_artifacts.palette import project_colour


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


def publish_report(http, text, project=None):
    (http.source / "report.md").write_text(text)
    http.registry.register(slug="report", title="Dream <report>", description="Nightly summary", status="published",
                           source_root=str(http.source), entry_path="report.md", format="markdown",
                           files={"report.md": "text/markdown"}, project=project)
    return http.client().get("/artifacts/a/report/")


def test_article_header_shows_project_colour_date_and_escaped_title(http, monkeypatch):
    # Project-owned work looks up its code checkout for links; this report has none.
    monkeypatch.setattr("battuta_artifacts.app.allowed_link_root", lambda project: None)
    response = publish_report(http, "Body", project="Battuta")

    assert response.status_code == 200
    assert f'--paint: {project_colour("Battuta")["paint"]}' in response.text
    assert '<span class="pill-swatch"></span>Battuta' in response.text
    assert "Updated " in response.text and "Date unavailable" not in response.text
    assert "Dream &lt;report&gt;" in response.text
    assert "Nightly summary" in response.text
    assert 'href="/artifacts/"' in response.text


@pytest.mark.parametrize(
    ("text", "ids", "contents"),
    [
        ("## Setup\n\n## Setup\n\n### Café notes\n", ["setup", "setup-2", "café-notes"], True),
        ("## One\n\n## Two\n", ["one", "two"], False),
        ("## ???\n\n## !!!\n\n## Done\n", ["section", "section-2", "done"], True),
    ],
    ids=["duplicates-and-unicode", "too-few-for-contents", "punctuation-only"],
)
def test_headings_get_unique_anchors_and_contents_need_three(http, text, ids, contents):
    response = publish_report(http, text)

    for anchor in ids:
        assert f'id="{anchor}"' in response.text
    assert ('class="contents"' in response.text) is contents
    if contents:
        assert all(f'href="#{anchor}"' in response.text for anchor in ids)
