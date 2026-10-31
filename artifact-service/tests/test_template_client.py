"""Run the shipped examples and their browser boundary behavior, not source snapshots."""

import json
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path

from battuta_artifacts.bundles import load_bundle


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.resources = []
        self.figures = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "link", "iframe"):
            self.resources.append(attrs.get("src") or attrs.get("href", ""))
        self.figures += tag == "figure"


class TemplateTests(unittest.TestCase):
    def test_complete_bundles_have_local_resources_and_working_examples(self):
        for template in ("report", "slides", "live-panel"):
            with self.subTest(template=template):
                bundle, contents = load_bundle(template)
                self.assertIn("USAGE.md", contents)
                self.assertIn("NOTICE.txt", contents)
                self.assertFalse(next(item for item in bundle.files if item.path == "USAGE.md").serve)
                parser = Links()
                parser.feed(contents["index.html"].decode())
                for resource in parser.resources:
                    self.assertNotRegex(resource, r"^(https?:)?//")
                    self.assertIn(resource.split("?")[0], contents)
                if template != "live-panel":
                    self.assertGreaterEqual(parser.figures, 2)
                    data = json.loads(contents["data/plot.json"])
                    self.assertTrue(data["illustrative"])
                    self.assertIn("vendor/three.module.js", contents)

    def test_visual_scripts_tolerate_removed_sections_and_failed_data(self):
        root = Path(__file__).parents[1] / "src/battuta_artifacts/scaffolds/report"
        script = r'''
          import assert from 'node:assert/strict';
          globalThis.document = { querySelectorAll: () => [] };
          await import(process.argv[1] + '/scene.js');
          const { drawPlots } = await import(process.argv[1] + '/plot.js');
          let calls = 0;
          await drawPlots(document, () => { calls++; throw Error('must not fetch'); });
          assert.equal(calls, 0);
          const status = {textContent: ''};
          const figure = {dataset: {plot: 'data/plot.json'}, querySelector: () => status};
          await drawPlots({querySelectorAll: () => [figure]}, async () => {throw Error('offline')});
          assert.ok(status.textContent.length > 0);
          assert.equal(figure.dataset.state, 'error');
        '''
        result = subprocess.run(["node", "--input-type=module", "-e", script, root.as_uri()],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
