"""Opt-in real Chromium acceptance; uses disposable files and no bot/model calls."""

import functools
import http.server
import os
import tempfile
import threading
import unittest
from pathlib import Path

from jinja2 import Environment, PackageLoader, select_autoescape

from battuta_artifacts.bundles import load_bundle


@unittest.skipUnless(os.environ.get("BATTUTA_ARTIFACT_BROWSER") == "1", "opt-in Chromium check")
class TemplateBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        for name in ("report", "slides", "live-panel"):
            bundle, contents = load_bundle(name)
            for entry in bundle.files:
                target = cls.root / name / entry.path
                target.parent.mkdir(parents=True, exist_ok=True)
                content = contents[entry.path]
                if entry.path == "index.html":
                    content = Environment(autoescape=True).from_string(content.decode()).render(
                        title="Capacity planning", description="An illustrative reference example").encode()
                target.write_bytes(content)
        from battuta_artifacts.markdown import render_markdown
        markdown = cls.root / 'markdown'
        markdown.mkdir()
        viewer = Environment(loader=PackageLoader('battuta_artifacts', 'templates'), autoescape=select_autoescape())
        (markdown / 'index.html').write_text(viewer.get_template('markdown.html').render(title='Research notes',
            content=render_markdown(b'# Research notes\n\n- Evidence\n- Uncertainty\n\n<script>alert(1)</script>\n')))
        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(cls.root)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, executable_path=os.environ.get("BATTUTA_BROWSER_EXECUTABLE"),
                                                     args=["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.tmp.cleanup()

    def page(self, **options):
        page = self.browser.new_page(**options)
        self.addCleanup(page.close)
        return page

    def capture(self, page, name):
        if directory := os.environ.get("BATTUTA_SCREENSHOTS"):
            Path(directory).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(directory) / f"{name}.png"), full_page=True)

    def test_report_and_slides_at_desktop_mobile_and_failure_boundaries(self):
        for name in ("report", "slides"):
            for width, height in ((1440, 1000), (390, 844)):
                with self.subTest(name=name, width=width):
                    page = self.page(viewport={"width": width, "height": height}, reduced_motion="reduce")
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(f"{self.url}/{name}/")
                    page.wait_for_selector('[data-plot][data-state="ready"]', state="attached")
                    page.wait_for_selector('[data-scene][data-state]', state="attached")
                    self.assertEqual(page.locator('[data-scene]').get_attribute('data-state'), 'ready')
                    self.assertFalse(errors, errors)
                    self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width)
                    if name == "slides":
                        for _ in range(5):
                            self.assertTrue(page.locator('#overflow').is_hidden())
                            page.keyboard.press('ArrowRight')
                        self.assertEqual(page.locator('#position').inner_text(), '6 / 6')
                        self.assertTrue(page.locator('#next').is_disabled())
                        page.keyboard.press('Home')
                        self.assertEqual(page.locator('#position').inner_text(), '1 / 6')
                        self.assertTrue(page.locator('#previous').is_disabled())
                    self.capture(page, f'{name}-{width}')
                    # Multiple figures use their own containers, not a singleton chart.
                    await_script = """async () => {
                      const figure = document.querySelector('[data-plot]');
                      figure.after(figure.cloneNode(true));
                      const { drawPlots } = await import('./plot.js');
                      await drawPlots();
                    }"""
                    page.evaluate(await_script)
                    self.assertEqual(page.locator('[data-plot] svg').count(), 2)
                    if name == "slides":
                        page.locator('.slide').first.evaluate("el => { el.style.height = '1400px'; }")
                        page.keyboard.press('Home')
                        self.assertTrue(page.locator('#overflow').is_visible())
                    page.route('**/data/plot.json', lambda route: route.abort())
                    page.reload()
                    page.wait_for_selector('[data-plot][data-state="error"]', state="attached")
                    self.assertTrue(page.locator('[data-plot] figcaption').text_content())
                    page.add_init_script("HTMLCanvasElement.prototype.getContext = () => null")
                    page.reload()
                    page.wait_for_selector('[data-scene][data-state="error"]', state="attached")
                    self.assertTrue(page.locator('[data-scene] button').first.is_disabled())
                    self.assertFalse(errors, errors)

    def test_live_panel_is_deterministic_static_by_default_and_controllable(self):
        for width, height in ((1440, 1000), (390, 844)):
            page = self.page(viewport={"width": width, "height": height}, reduced_motion="reduce")
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'{self.url}/live-panel/')
            panel = page.frames[1]
            panel.wait_for_function('window.__ready')
            self.assertFalse(panel.evaluate('Boolean(window.__error)'))
            first = panel.locator('#stage').inner_text()
            self.assertEqual(page.locator('#position').inner_text(), '0.0 s')
            page.locator('#time').fill('12')
            page.locator('#time').dispatch_event('input')
            self.assertEqual(panel.evaluate('window.__t'), 12)
            page.locator('#reset').click()
            self.assertEqual(panel.locator('#stage').inner_text(), first)
            page.locator('#play').click()
            page.wait_for_function("document.querySelector('#time').value > 0")
            page.locator('#play').click()
            self.assertEqual(page.locator('#play').get_attribute('aria-pressed'), 'false')
            self.assertFalse(errors, errors)
            self.capture(page, f'live-panel-{width}')
            page.route('**/config.json', lambda route: route.abort())
            page.reload()
            page.wait_for_function("document.querySelector('iframe').contentWindow.__error")
            page.locator('#reset').click()
            self.assertIn('unavailable', page.locator('#status').inner_text())

    def test_playback_accumulates_regular_frames_independently_of_native_range_rounding(self):
        page = self.page()
        page.add_init_script('''
          window.clock = {now: 0, callbacks: []};
          performance.now = () => clock.now;
          window.requestAnimationFrame = callback => clock.callbacks.push(callback);
          window.advance = frames => {
            for (let frame = 0; frame < frames; frame++) {
              clock.now += 1000 / 60;
              const pending = clock.callbacks.splice(0);
              pending.forEach(callback => callback(clock.now));
            }
          };
        ''')
        page.goto(f'{self.url}/live-panel/')
        panel = page.frames[1]
        panel.wait_for_function('window.__ready')
        page.locator('#play').click()
        page.evaluate('advance(120)')
        self.assertAlmostEqual(panel.evaluate('window.__t'), 2, places=5)
        self.assertEqual(page.locator('#position').inner_text(), '2.0 s')
        page.locator('#play').click()
        page.evaluate('advance(60)')
        self.assertAlmostEqual(panel.evaluate('window.__t'), 2, places=5)
        page.locator('#time').fill('12')
        page.locator('#time').dispatch_event('input')
        page.locator('#play').click()
        page.evaluate('advance(60)')
        self.assertAlmostEqual(panel.evaluate('window.__t'), 13, places=5)
        page.locator('#reset').click()
        page.locator('#play').click()
        page.evaluate('advance(60)')
        self.assertAlmostEqual(panel.evaluate('window.__t'), 1, places=5)

    def test_markdown_viewer_is_readable_without_executing_raw_html(self):
        page = self.page(viewport={'width': 390, 'height': 844})
        dialogs = []
        page.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
        page.goto(f'{self.url}/markdown/')
        self.assertTrue(page.get_by_role('heading', name='Research notes', exact=True).first.is_visible())
        self.assertEqual(page.locator('li').count(), 2)
        self.assertEqual(dialogs, [])
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        self.capture(page, 'markdown-390')


if __name__ == "__main__":
    unittest.main()
