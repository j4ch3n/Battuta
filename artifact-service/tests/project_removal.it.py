"""Cross-package project removal and artifact withdrawal."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from battuta_artifacts.registry import Registry, migrate


class ProjectRemovalIntegration(unittest.TestCase):
    def test_withdraws_artifacts_and_preserves_project_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            env = {**os.environ, "HOME": str(home), "LINEAR_API_TOKEN": "test",
                   "BATTUTA_ARTIFACT_DB": str(home / "registry.sqlite3"),
                   "PYTHONPATH": str(Path(__file__).resolve().parents[2] / "project-context-cli/src"),
                   "PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ['PATH']}"}
            def run(*args):
                return subprocess.run(args, env=env, capture_output=True, text=True)

            init = run("battuta-project", "init", "atlas")
            self.assertEqual(init.returncode, 0, init.stderr)
            root = home / ".battuta/projects/atlas"
            (root / ".draft").write_text("preserved")
            db = home / "registry.sqlite3"
            migrate(db)
            store = Registry(db)
            store.register(slug="atlas-report", title="Report", description="Report",
                           source_root=str(root), entry_path=".draft", format="markdown",
                           files={".draft": "text/markdown"}, status="published")
            store.register(slug="other", title="Other", description="Other",
                           source_root="/unrelated", entry_path="index.html", format="html",
                           files={"index.html": "text/html"})
            result = run("battuta-project", "remove", "atlas")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(root.exists())
            self.assertEqual([item["slug"] for item in store.list()], ["other"])
            self.assertEqual(next((home / ".Trash").glob("atlas-*/atlas/.draft")).read_text(), "preserved")
            listing = run("battuta-project", "list", "--json")
            self.assertEqual(json.loads(listing.stdout)["projects"], [])


if __name__ == "__main__":
    unittest.main()
