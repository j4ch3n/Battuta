import json
import os
import re
import sqlite3
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from battuta_artifacts.bundles import load_bundle
from battuta_artifacts.cli import main
from battuta_artifacts.registry import ArtifactError, Registry
from battuta_artifacts.vendors import select_vendors


@pytest.mark.parametrize("args", [(), ("--vendor", "unknown")], ids=["no-vendor", "unknown-vendor"])
def test_invalid_vendor_selection_creates_no_draft(bundle, args):
    result = bundle.init(*args)

    assert result.exit_code != 0, result.output
    assert not bundle.directory.exists()
    assert bundle.store.list() == []


def test_load_bundle_requires_at_least_one_vendor():
    with pytest.raises(ArtifactError, match="vendor"):
        load_bundle(())


def test_missing_starter_resources_fail_before_creating_a_draft(tmp_path):
    with pytest.raises(ArtifactError, match="Starter is unavailable"):
        load_bundle(("mermaid",), starter=tmp_path)


@pytest.mark.parametrize(
    ("selection", "names"),
    [
        ("katex", {"katex"}),
        ("live-diagram", {"mermaid", "live-diagram"}),
    ],
    ids=["single-vendor", "with-required-vendor"],
)
def test_each_selection_generates_only_its_resolved_extension_styles(selection, names):
    bundle, _ = load_bundle((selection,))

    assert {entry.path for entry in bundle.files if entry.path.startswith("vendor/") and entry.path.endswith(".css")} == {
        f"vendor/{name}.css" for name in names
    }


def test_symlinked_artifact_directory_is_not_followed(bundle):
    outside = bundle.home / "outside"
    outside.mkdir()
    (bundle.project / "artifacts").symlink_to(outside, target_is_directory=True)

    result = bundle.init("--vendor", "mermaid")

    assert result.exit_code != 0, result.output
    assert list(outside.iterdir()) == []
    assert bundle.store.list() == []


def test_existing_destination_is_preserved(bundle):
    bundle.directory.mkdir(parents=True)
    marker = bundle.directory / "working.txt"
    marker.write_text("keep this work")

    result = bundle.init("--vendor", "mermaid")

    assert result.exit_code != 0
    assert marker.read_text() == "keep this work"
    assert bundle.store.list() == []


def fail_style_write():
    real_open = os.open

    def fail(path, flags, *args, **kwargs):
        if path == "mermaid.css" and flags & os.O_WRONLY:
            raise OSError("style write failed")
        return real_open(path, flags, *args, **kwargs)

    return patch("battuta_artifacts.bundles.os.open", side_effect=fail)


def fail_registration():
    return patch.object(Registry, "register", side_effect=sqlite3.OperationalError("registration failed"))


@pytest.mark.parametrize("failure", [fail_style_write, fail_registration], ids=["style-write", "registration"])
def test_write_and_registration_failures_remove_only_incomplete_draft(bundle, failure):
    sibling = bundle.project / "artifacts/other.txt"
    sibling.parent.mkdir()
    sibling.write_text("keep")

    with failure():
        result = bundle.init("--vendor", "mermaid")

    assert result.exit_code == 5, result.output
    assert not bundle.directory.exists()
    assert bundle.store.list() == []
    assert sibling.read_text() == "keep"


def test_live_diagram_bundle_links_resolved_css_and_matching_import_maps(bundle):
    result = bundle.init("--vendor", "live-diagram")

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["artifact"]["status"] == "draft"
    assert payload["artifact"]["template"] is None
    assert {entry["path"] for entry in payload["files"]} == {
        "index.html",
        "styles.css",
        "index.js",
        "vendor/importmap.json",
        "vendor/mermaid.css",
        "vendor/live-diagram.css",
        "NOTICE.txt",
    }
    assert [vendor["name"] for vendor in payload["vendors"]] == ["mermaid", "live-diagram"]
    assert not payload["vendors"][0]["selected"]
    assert payload["vendors"][1]["selected"]
    assert payload["vendors"][0]["stylesheets"] == ["vendor/mermaid.css"]
    html = (bundle.directory / "index.html").read_text()
    assert html.index('href="styles.css"') < html.index('href="vendor/mermaid.css"')
    assert html.index('href="vendor/mermaid.css"') < html.index('href="vendor/live-diagram.css"')
    inline_map = json.loads(re.search(r'<script type="importmap">(.*?)</script>', html, re.DOTALL).group(1))
    assert inline_map == json.loads((bundle.directory / "vendor/importmap.json").read_text())
    assert not (bundle.directory / "USAGE.md").exists()


def test_human_output_identifies_available_imports_and_local_styles(bundle):
    result = CliRunner().invoke(
        main,
        ["init", "sizing", "--project", "procurement", "--title", "Sizing", "--description", "Evidence",
         "--vendor", "live-diagram"],
    )

    assert result.exit_code == 0, result.output
    assert "mermaid (required)" in result.output
    assert "live-diagram (selected)" in result.output
    assert "vendor/live-diagram.css" in result.output
    assert str(bundle.directory) in result.output
    assert select_vendors(("live-diagram",))[1].purpose in result.output
