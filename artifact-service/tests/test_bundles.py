import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

from battuta_artifacts.bundles import load_bundle
from battuta_artifacts.cli import main
from battuta_artifacts.registry import ArtifactError, Registry, migrate


class BundleFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.environment = patch.dict(
            os.environ,
            {
                "HOME": str(self.home),
                "BATTUTA_ARTIFACT_DB": str(self.home / "registry.db"),
                "BATTUTA_ARTIFACT_BASE_URL": "",
                "LINEAR_API_TOKEN": "",
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.project = self.home / ".battuta/projects/procurement"
        (self.project / "code").mkdir(parents=True)
        (self.project / "project.yaml").write_text(
            json.dumps({"version": 1, "linear": {"project_id": None, "team_id": None}, "github": {"repository": None}})
        )
        self.store = Registry(self.home / "registry.db")
        migrate(self.store.path)

    def init(self, *args):
        return CliRunner().invoke(
            main,
            [
                "init",
                "sizing",
                "--project",
                "procurement",
                "--title",
                'VRAM <sizing> "guide"',
                "--description",
                "Evidence & assumptions",
                *args,
                "--json",
            ],
        )


class BundleTests(BundleFixture):
    def test_empty_vendor_selection_is_rejected_without_creating_a_draft(self):
        result = self.init()

        self.assertNotEqual(result.exit_code, 0, result.output)
        self.assertFalse((self.project / "artifacts/sizing").exists())
        self.assertEqual(self.store.list(), [])

    def test_unknown_vendors_and_template_mode_do_not_create_a_draft(self):
        for args in (("--vendor", "unknown"), ("--vendor", "mermaid", "--template", "report")):
            with self.subTest(args=args):
                result = self.init(*args)
                self.assertNotEqual(result.exit_code, 0, result.output)
                self.assertFalse((self.project / "artifacts/sizing").exists())
                self.assertEqual(self.store.list(), [])

    def test_load_bundle_requires_at_least_one_vendor(self):
        with self.assertRaisesRegex(ArtifactError, "vendor"):
            load_bundle(())

    def test_missing_starter_resources_fail_before_creating_a_draft(self):
        with self.assertRaisesRegex(ArtifactError, "Starter is unavailable"):
            load_bundle(("mermaid",), starter=self.home)

    def test_each_selection_generates_only_its_resolved_extension_styles(self):
        expected = {
            "reveal": {"reveal"},
            "chartjs": {"chartjs"},
            "three": {"three"},
            "mermaid": {"mermaid"},
            "photoswipe": {"photoswipe"},
            "katex": {"katex"},
            "animejs": {"animejs"},
            "live-diagram": {"mermaid", "live-diagram"},
        }

        for selection, names in expected.items():
            with self.subTest(selection=selection):
                bundle, _ = load_bundle((selection,))
                self.assertEqual(
                    {entry.path for entry in bundle.files if entry.path.startswith("vendor/") and entry.path.endswith(".css")},
                    {f"vendor/{name}.css" for name in names},
                )

    def test_symlinked_artifact_directory_is_not_followed(self):
        outside = self.home / "outside"
        outside.mkdir()
        (self.project / "artifacts").symlink_to(outside, target_is_directory=True)

        result = self.init("--vendor", "mermaid")

        self.assertNotEqual(result.exit_code, 0, result.output)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(self.store.list(), [])

    def test_live_diagram_bundle_links_resolved_css_and_matching_import_maps(self):
        result = self.init("--vendor", "live-diagram")

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        directory = self.project / "artifacts/sizing"
        self.assertEqual(payload["artifact"]["status"], "draft")
        self.assertIsNone(payload["artifact"]["template"])
        self.assertEqual(
            {entry["path"] for entry in payload["files"]},
            {
                "index.html",
                "styles.css",
                "index.js",
                "vendor/importmap.json",
                "vendor/mermaid.css",
                "vendor/live-diagram.css",
                "NOTICE.txt",
            },
        )
        self.assertEqual([vendor["name"] for vendor in payload["vendors"]], ["mermaid", "live-diagram"])
        self.assertFalse(payload["vendors"][0]["selected"])
        self.assertTrue(payload["vendors"][1]["selected"])
        self.assertEqual(payload["vendors"][0]["stylesheets"], ["vendor/mermaid.css"])
        html = (directory / "index.html").read_text()
        self.assertLess(html.index('href="styles.css"'), html.index('href="vendor/mermaid.css"'))
        self.assertLess(html.index('href="vendor/mermaid.css"'), html.index('href="vendor/live-diagram.css"'))
        inline_map = json.loads(re.search(r'<script type="importmap">(.*?)</script>', html, re.DOTALL).group(1))
        self.assertEqual(inline_map, json.loads((directory / "vendor/importmap.json").read_text()))
        self.assertFalse((directory / "USAGE.md").exists())

    def test_human_output_identifies_available_imports_and_local_styles(self):
        result = CliRunner().invoke(
            main,
            [
                "init",
                "sizing",
                "--project",
                "procurement",
                "--title",
                "Sizing",
                "--description",
                "Evidence",
                "--vendor",
                "live-diagram",
            ],
        )

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Configured vendors:", result.output)
        self.assertIn("mermaid (required)", result.output)
        self.assertIn("live-diagram (selected)", result.output)
        self.assertIn("vendor/live-diagram.css", result.output)
