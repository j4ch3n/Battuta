"""Both live-panel scaffold copies emit supported light-theme colors."""

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LivePanelScaffoldTests(unittest.TestCase):
    def test_fifth_light_theme_box_has_the_teal_palette_color(self):
        for path in (ROOT / "skills-hub/present-to-owner/references/live-panel/scripts/scaffold.py", ROOT / "artifact-service/src/battuta_artifacts/scaffolds/live-panel/scaffold.py"):
            with self.subTest(path=str(path.relative_to(ROOT))):
                spec = importlib.util.spec_from_file_location("live_panel_scaffold", path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                config = module.build({"theme": "light-pastel", "rows": [[{"name": str(index), "lines": []} for index in range(5)]], "log": False})
                boxes = [element for element in config["elements"] if element["type"] == "box"]
                self.assertEqual(boxes[4]["color"], "tl")
