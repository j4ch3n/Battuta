"""Generate a current vendor bundle from wheel resources outside the checkout."""

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

SCRIPT = """
import json, sys
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


def test_installed_resources_generate_selected_styles_and_notices(tmp_path):
    package = Path(__file__).resolve().parents[2]
    built = subprocess.run(["uv", "build", "--wheel", "--out-dir", str(tmp_path / "dist"), str(package)],
                           capture_output=True, text=True, timeout=120)
    assert built.returncode == 0, built.stdout + built.stderr
    installed = tmp_path / "installed"
    with zipfile.ZipFile(next((tmp_path / "dist").glob("*.whl"))) as archive:
        archive.extractall(installed)
    result = subprocess.run([sys.executable, "-I", "-c", SCRIPT, str(installed)],
                            cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output["served"] == ["index.html", "index.js", "styles.css", "vendor/live-diagram.css", "vendor/mermaid.css"]
    assert len(output["paths"]) == 7
    assert [vendor["name"] for vendor in output["vendors"]] == ["mermaid", "live-diagram"]
    assert not output["vendors"][0]["selected"]
    assert output["notice"] and output["styles"]
