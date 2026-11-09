import unittest
from unittest.mock import patch

from battuta_artifacts.registry import ArtifactError
from battuta_artifacts.vendors import Vendor, import_map, load_vendors, select_vendors


class VendorTests(unittest.TestCase):
    @staticmethod
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

    def test_catalog_has_the_eight_supported_vendor_capabilities(self):
        vendors = load_vendors()

        self.assertEqual(
            [vendor.name for vendor in vendors],
            ["reveal", "chartjs", "three", "mermaid", "photoswipe", "katex", "animejs", "live-diagram"],
        )
        self.assertEqual(
            {name for vendor in vendors for name in vendor.summary()["imports"]},
            {
                "reveal.js",
                "chart.js/auto",
                "three",
                "three/addons/",
                "mermaid",
                "photoswipe",
                "photoswipe/lightbox",
                "katex",
                "katex/contrib/auto-render",
                "animejs",
                "live-diagram",
            },
        )
        self.assertTrue(all(vendor.summary()["purpose"] for vendor in vendors))
        self.assertEqual(
            next(vendor for vendor in vendors if vendor.name == "katex").summary()["stylesheets"],
            ["vendor/katex.css"],
        )

    def test_live_diagram_selects_mermaid_as_a_required_capability(self):
        selected = select_vendors(("live-diagram",))

        self.assertEqual([vendor.name for vendor in selected], ["mermaid", "live-diagram"])
        self.assertFalse(selected[0].summary(selected=False)["selected"])
        self.assertTrue(selected[1].summary(selected=True)["selected"])
        self.assertEqual(selected[1].summary()["stylesheets"], ["vendor/live-diagram.css"])

    def test_required_capabilities_are_deduplicated_in_catalog_order(self):
        selected = select_vendors(("live-diagram", "mermaid", "live-diagram"))

        self.assertEqual([vendor.name for vendor in selected], ["mermaid", "live-diagram"])

    def test_selection_is_canonical_and_deduplicated(self):
        self.assertEqual(
            [vendor.name for vendor in select_vendors(("three", "three", "animejs"))],
            ["three", "animejs"],
        )
        self.assertEqual(select_vendors(("animejs", "three")), select_vendors(("three", "animejs")))

    def test_unknown_vendor_is_rejected(self):
        with self.assertRaisesRegex(ArtifactError, "Unknown vendor"):
            select_vendors(("unknown",))

    def test_import_maps_are_empty_or_merge_dependencies(self):
        self.assertEqual(import_map(()), {"imports": {}})
        mapping = import_map(select_vendors(("chartjs",)))
        self.assertIn("chart.js/auto", mapping["imports"])
        self.assertIn("@kurkle/color", mapping["imports"])

    def test_conflicting_import_mappings_are_rejected(self):
        left = self.vendor("left", imports={"shared": "https://example.test/left@1.2.3/a.js"})
        right = self.vendor("right", imports={"shared": "https://example.test/right@1.2.3/b.js"})

        with self.assertRaisesRegex(ArtifactError, "conflicting import"):
            import_map((left, right))

    def test_invalid_catalog_resources_and_urls_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            self.vendor("credentials", imports={"credentials": "https://token@example.test/pkg@1.2.3/index.js"})
        with self.assertRaisesRegex(ValueError, "pinned"):
            self.vendor("floating", imports={"floating": "https://example.test/pkg@latest/index.js"})
        with self.assertRaisesRegex(ValueError, "safe package-relative"):
            Vendor(
                name="unsafe",
                version="1.2.3",
                purpose="Unsafe",
                imports={"unsafe": "https://example.test/unsafe@1.2.3/index.js"},
                source="https://github.com/example/unsafe/tree/v1.2.3",
                style="../unsafe.css",
                licenses=("licenses/unsafe.txt",),
            )

    def test_style_and_license_resources_stay_in_their_own_directories(self):
        with self.assertRaisesRegex(ValueError, "style resources"):
            self.vendor("wrong-style", style="licenses/wrong-style.txt")
        with self.assertRaisesRegex(ValueError, "license resources"):
            self.vendor("wrong-license", licenses=("styles/wrong-license.css",))

    def test_license_provenance_is_required(self):
        with self.assertRaisesRegex(ValueError, "licenses"):
            Vendor(
                name="unattributed",
                version="1.2.3",
                purpose="Unattributed capability",
                imports={"unattributed": "https://example.test/unattributed@1.2.3/index.js"},
                source="https://github.com/example/unattributed/tree/v1.2.3",
                style="styles/unattributed.css",
            )

    def test_dependency_mappings_accept_their_own_pinned_versions(self):
        vendor = Vendor(
            name="parent",
            version="1.2.3",
            purpose="Parent capability",
            imports={"parent": "https://example.test/parent@1.2.3/index.js"},
            dependencies={"child": "https://example.test/child@0.3.4/index.js"},
            source="https://github.com/example/parent/tree/v1.2.3",
            style="styles/parent.css",
            licenses=("licenses/parent.txt",),
        )

        self.assertEqual(import_map((vendor,))["imports"]["child"], "https://example.test/child@0.3.4/index.js")

    def test_missing_and_cyclic_requirements_are_rejected(self):
        missing = self.vendor("requires-missing", requires=("absent",))
        left = self.vendor("left", requires=("right",))
        right = self.vendor("right", requires=("left",))

        with patch("battuta_artifacts.vendors.load_vendors", return_value=(missing,)):
            with self.assertRaisesRegex(ArtifactError, "requires unknown"):
                select_vendors(("requires-missing",))
        with patch("battuta_artifacts.vendors.load_vendors", return_value=(left, right)):
            with self.assertRaisesRegex(ArtifactError, "cyclic"):
                select_vendors(("left",))
