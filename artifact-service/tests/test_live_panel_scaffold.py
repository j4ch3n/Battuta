"""Both live-panel scaffold copies emit supported light-theme colors."""

import importlib.util
from pathlib import Path
import sys
import unittest

from battuta_artifacts.bundles import load_bundle

ROOT = Path(__file__).resolve().parents[2]


def load_scaffold(path, name):
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.dont_write_bytecode = previous


class LivePanelScaffoldTests(unittest.TestCase):
    def test_fifth_light_theme_box_has_the_teal_palette_color(self):
        for path in (ROOT / "skills-hub/present-to-owner/references/live-panel/scripts/scaffold.py", ROOT / "artifact-service/src/battuta_artifacts/scaffolds/live-panel/scaffold.py"):
            with self.subTest(path=str(path.relative_to(ROOT))):
                module = load_scaffold(path, "live_panel_scaffold")
                config = module.build({"theme": "light-pastel", "rows": [[{"name": str(index), "lines": []} for index in range(5)]], "log": False})
                boxes = [element for element in config["elements"] if element["type"] == "box"]
                self.assertEqual(boxes[4]["color"], "tl")

    def test_scaffold_import_does_not_break_packaged_inventory(self):
        path = ROOT / "artifact-service/src/battuta_artifacts/scaffolds/live-panel/scaffold.py"
        load_scaffold(path, "live_panel_scaffold_inventory")

        load_bundle("live-panel")
