"""Generate a current vendor bundle from wheel resources outside the checkout."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


class WheelResourceTests(unittest.TestCase):
    def test_installed_resources_generate_selected_styles_and_notices(self):
        package = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            result = subprocess.run(
                ["uv", "build", "--wheel", "--out-dir", str(root / "dist"), str(package)],
                capture_output=True, text=True, timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            wheel = next((root / "dist").glob("*.whl"))
            installed = root / "installed"
            with zipfile.ZipFile(wheel) as archive:
                archive.extractall(installed)
            script = """
import json, pathlib, sys
sys.path.insert(0, sys.argv[1])
from battuta_artifacts.bundles import load_bundle
from battuta_artifacts.vendors import select_vendors
bundle, contents = load_bundle(('live-diagram',))
print(json.dumps({
    'paths': sorted(entry.path for entry in bundle.files),
    'served': sorted(entry.path for entry in bundle.files if entry.serve),
    'vendors': [vendor.summary(selected=vendor.name == 'live-diagram') for vendor in select_vendors(('live-diagram',))],
    'notice': bool(contents['NOTICE.txt']),
    'styles': all(contents[path] for path in ('vendor/mermaid.css', 'vendor/live-diagram.css')),
}))
"""
            result = subprocess.run(
                [sys.executable, "-I", "-c", script, str(installed)],
                cwd=root, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output["served"], [
                "index.html", "index.js", "styles.css", "vendor/live-diagram.css", "vendor/mermaid.css",
            ])
            self.assertEqual(len(output["paths"]), 7)
            self.assertEqual([vendor["name"] for vendor in output["vendors"]], ["mermaid", "live-diagram"])
            self.assertFalse(output["vendors"][0]["selected"])
            self.assertTrue(output["notice"])
            self.assertTrue(output["styles"])


if __name__ == "__main__":
    unittest.main()
