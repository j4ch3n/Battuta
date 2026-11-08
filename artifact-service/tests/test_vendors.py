import unittest

from battuta_artifacts.registry import ArtifactError
from battuta_artifacts.vendors import Vendor, import_map, load_vendors, select_vendors


class VendorTests(unittest.TestCase):
    def test_catalog_has_the_seven_supported_vendor_capabilities(self):
        vendors = load_vendors()

        self.assertEqual(
            [vendor.name for vendor in vendors],
            ["reveal", "chartjs", "three", "mermaid", "photoswipe", "katex", "animejs"],
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
            },
        )
        self.assertTrue(all(vendor.summary()["purpose"] for vendor in vendors))
        self.assertEqual(next(vendor for vendor in vendors if vendor.name == "katex").summary()["stylesheets"],
                         ["https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css"])

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
        left = Vendor(name="left", version="1", purpose="Left", imports={"shared": "https://example.test/a.js"})
        right = Vendor(name="right", version="1", purpose="Right", imports={"shared": "https://example.test/b.js"})

        with self.assertRaisesRegex(ArtifactError, "conflicting import"):
            import_map((left, right))
