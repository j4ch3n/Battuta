import json
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.source = self.root / "source"
        self.source.mkdir()
        # Content is intentionally not HTML: extensions, not sniffing, determine format.
        (self.source / "index.html").write_text("trusted by extension")
        (self.source / "app.js").write_text("console.log('demo')")
        self.db = self.root / "registry.sqlite3"
        self.runner = CliRunner(env={"BATTUTA_ARTIFACT_DB": str(self.db)})

    def run_cli(self, *args):
        from battuta_artifacts.cli import main
        return self.runner.invoke(main, args)

    def register(self):
        return self.run_cli("register", "--slug", "demo", "--title", "Demo", "--description", "Walkthrough",
                            "--root", str(self.source), "--entry", "index.html", "--file", "app.js", "--json")

    def test_setup_is_explicit(self):
        result = self.run_cli("list", "--json")
        self.assertEqual(result.exit_code, 5, result.output)
        self.assertEqual(json.loads(result.output)["error"]["code"], "SCHEMA_MISMATCH")
        self.assertFalse(self.db.exists())
        for _ in range(2):
            self.assertEqual(self.run_cli("setup").exit_code, 0)

    def test_bundle_registration_update_replace_and_deregister(self):
        self.run_cli("setup")
        result = self.register()
        self.assertEqual(result.exit_code, 0, result.output)
        artifact = json.loads(result.output)["artifact"]
        self.assertEqual(artifact["url"], "https://pi.fiscum.co.uk/artifacts/a/demo/")
        self.assertEqual(artifact["format"], "html")
        self.assertEqual(set(artifact["files"]), {"index.html", "app.js"})
        conflict = self.run_cli("update", "demo", "--title", "Changed", "--expected-revision", "9", "--json")
        self.assertEqual(conflict.exit_code, 4)
        self.assertEqual(self.run_cli("update", "demo", "--title", "Changed").exit_code, 0)
        (self.source / "report.md").write_text("# Report")
        result = self.run_cli("replace-files", "demo", "--root", str(self.source), "--entry", "report.md", "--json")
        self.assertEqual(result.exit_code, 0, result.output)
        artifact = json.loads(result.output)["artifact"]
        self.assertEqual(artifact["files"], {"report.md": "text/markdown"})
        self.assertEqual(artifact["title"], "Changed")
        self.assertEqual(artifact["revision"], 3)
        self.assertEqual(self.run_cli("deregister", "demo", "--expected-revision", "3").exit_code, 0)
        self.assertTrue((self.source / "index.html").exists())
        self.assertEqual(json.loads(self.run_cli("list", "--json").output)["artifacts"], [])
        self.assertEqual(self.run_cli("show", "demo").exit_code, 3)

    def test_single_file_and_json_output_before_subcommand(self):
        self.run_cli("setup")
        result = self.run_cli("--json", "register", "--slug", "one", "--title", "One", "--description", "Page",
                              "--entry", str(self.source / "index.html"))
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(set(json.loads(result.output)["artifact"]["files"]), {"index.html"})

    def test_invalid_paths_and_parameters_have_no_side_effects(self):
        self.run_cli("setup")
        (self.source / "linked.js").symlink_to(self.source / "app.js")
        for extra in [("--file", "../secret"), ("--file", "*.js"), ("--file", "/etc/passwd"),
                      ("--file", "linked.js"), ("--file", "missing.js"), ("--file", "a%2fb.js"),
                      ("--file", "app.js", "--file", "app.js")]:
            with self.subTest(extra=extra):
                result = self.run_cli("register", "--slug", "demo", "--title", "Demo", "--description", "Page",
                                      "--root", str(self.source), "--entry", "index.html", *extra, "--json")
                self.assertEqual(result.exit_code, 2, result.output)
                self.assertFalse(json.loads(result.output)["ok"])
        self.assertEqual(json.loads(self.run_cli("list", "--json").output)["artifacts"], [])
        for slug in ["../escape", "Bad", "bad--slug"]:
            result = self.run_cli("register", "--slug", slug, "--title", "Demo", "--description", "Page",
                                  "--entry", str(self.source / "index.html"))
            self.assertEqual(result.exit_code, 2)

    def test_update_requires_a_change_and_parser_errors_are_json(self):
        self.run_cli("setup")
        self.register()
        self.assertEqual(self.run_cli("update", "demo").exit_code, 2)
        result = self.run_cli("register", "--json")
        self.assertEqual(result.exit_code, 2)
        self.assertEqual(json.loads(result.output)["error"]["code"], "INVALID_INPUT")
