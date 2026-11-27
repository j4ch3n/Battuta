from unittest.mock import patch

import pytest

from battuta_artifacts.registry import ArtifactError
from battuta_artifacts.vendors import Vendor, import_map, load_vendors, select_vendors


def vendor(name, *, imports=None, requires=(), style=None, licenses=None):
    return Vendor(
        name=name,
        version="1.2.3",
        purpose=f"{name} capability",
        imports=imports or {name: f"https://cdn.example.test/npm/{name}@1.2.3/index.js"},
        requires=requires,
        source=f"https://github.com/example/{name}/tree/v1.2.3",
        style=style or f"styles/{name}.css",
        licenses=licenses or (f"licenses/{name}.txt",),
    )


def test_catalog_vendors_summarize_purpose_imports_and_local_stylesheet():
    for loaded in load_vendors():
        summary = loaded.summary()
        assert summary["purpose"]
        assert summary["imports"]
        assert summary["stylesheets"] == [f"vendor/{loaded.name}.css"]


def test_live_diagram_selects_mermaid_as_a_required_capability():
    selected = select_vendors(("live-diagram",))

    assert [item.name for item in selected] == ["mermaid", "live-diagram"]
    assert not selected[0].summary(selected=False)["selected"]
    assert selected[1].summary(selected=True)["selected"]
    assert selected[1].summary()["stylesheets"] == ["vendor/live-diagram.css"]


def test_required_capabilities_are_deduplicated_in_catalog_order():
    selected = select_vendors(("live-diagram", "mermaid", "live-diagram"))

    assert [item.name for item in selected] == ["mermaid", "live-diagram"]


def test_selection_is_canonical_and_deduplicated():
    assert [item.name for item in select_vendors(("three", "three", "animejs"))] == ["three", "animejs"]
    assert select_vendors(("animejs", "three")) == select_vendors(("three", "animejs"))


def test_unknown_vendor_is_rejected():
    with pytest.raises(ArtifactError, match="Unknown vendor"):
        select_vendors(("unknown",))


def test_import_maps_are_empty_or_merge_dependencies():
    assert import_map(()) == {"imports": {}}
    mapping = import_map(select_vendors(("chartjs",)))
    assert "chart.js/auto" in mapping["imports"]
    assert "@kurkle/color" in mapping["imports"]


def test_conflicting_import_mappings_are_rejected():
    left = vendor("left", imports={"shared": "https://example.test/left@1.2.3/a.js"})
    right = vendor("right", imports={"shared": "https://example.test/right@1.2.3/b.js"})

    with pytest.raises(ArtifactError, match="conflicting import"):
        import_map((left, right))


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"imports": {"credentials": "https://token@example.test/pkg@1.2.3/index.js"}}, "HTTPS"),
        ({"imports": {"floating": "https://example.test/pkg@latest/index.js"}}, "pinned"),
        ({"style": "../unsafe.css"}, "safe package-relative"),
        ({"style": "licenses/wrong-style.txt"}, "style resources"),
        ({"licenses": ("styles/wrong-license.css",)}, "license resources"),
    ],
    ids=["credentials-in-url", "floating-version", "escaping-style", "style-outside-styles", "license-outside-licenses"],
)
def test_invalid_catalog_resources_and_urls_are_rejected(overrides, message):
    with pytest.raises(ValueError, match=message):
        vendor("invalid", **overrides)


def test_license_provenance_is_required():
    with pytest.raises(ValueError, match="licenses"):
        Vendor(
            name="unattributed",
            version="1.2.3",
            purpose="Unattributed capability",
            imports={"unattributed": "https://example.test/unattributed@1.2.3/index.js"},
            source="https://github.com/example/unattributed/tree/v1.2.3",
            style="styles/unattributed.css",
        )


def test_dependency_mappings_accept_their_own_pinned_versions():
    parent = Vendor(
        name="parent",
        version="1.2.3",
        purpose="Parent capability",
        imports={"parent": "https://example.test/parent@1.2.3/index.js"},
        dependencies={"child": "https://example.test/child@0.3.4/index.js"},
        source="https://github.com/example/parent/tree/v1.2.3",
        style="styles/parent.css",
        licenses=("licenses/parent.txt",),
    )

    assert import_map((parent,))["imports"]["child"] == "https://example.test/child@0.3.4/index.js"


@pytest.mark.parametrize(
    ("catalog", "selection", "message"),
    [
        ((vendor("requires-missing", requires=("absent",)),), "requires-missing", "requires unknown"),
        ((vendor("left", requires=("right",)), vendor("right", requires=("left",))), "left", "cyclic"),
    ],
    ids=["missing-requirement", "cyclic-requirement"],
)
def test_missing_and_cyclic_requirements_are_rejected(catalog, selection, message):
    with patch("battuta_artifacts.vendors.load_vendors", return_value=catalog), pytest.raises(ArtifactError, match=message):
        select_vendors((selection,))
