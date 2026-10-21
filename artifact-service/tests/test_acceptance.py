"""Real CLI processes and HTTP/SSE; no tunnel or host service changes."""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen


class AcceptanceTests(unittest.TestCase):
    def test_cli_and_server_bundle_markdown_events_and_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "source"
            source.mkdir()
            (source / "index.html").write_text('<link rel="stylesheet" href="main.css"><script src="app.js"></script>')
            (source / "main.css").write_text("body {color: green}")
            (source / "app.js").write_text("console.log('demo')")
            (source / "secret.txt").write_text("unregistered")
            env = {**os.environ, "BATTUTA_ARTIFACT_DB": str(root / "registry.sqlite3")}
            command = [sys.executable, "-c", "from battuta_artifacts.cli import main; main()"]

            def cli(*args):
                result = subprocess.run([*command, *args, "--json"], env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                return json.loads(result.stdout)

            cli("setup")
            cli("register", "--slug", "demo", "--title", "Demo", "--description", "Walkthrough",
                "--root", str(source), "--entry", "index.html", "--file", "main.css", "--file", "app.js")
            with (root / "server.log").open("w+") as log:
                process = subprocess.Popen([*command, "serve", "--port", "0"], env=env, stdout=log, stderr=log)
                try:
                    deadline = time.monotonic() + 10
                    address = None
                    while time.monotonic() < deadline and process.poll() is None:
                        log.seek(0)
                        match = re.search(r"http://127\.0\.0\.1:(\d+)", log.read())
                        if match:
                            address = match.group()
                            break
                        time.sleep(0.05)
                    self.assertIsNotNone(address, "Service failed to start; inspect temporary server log")

                    def get(path):
                        with urlopen(address + path, timeout=4) as response:
                            return response.read().decode()

                    self.assertIn("Demo", get("/artifacts/"))
                    self.assertIn('src="app.js"', get("/artifacts/a/demo/"))
                    self.assertIn("color: green", get("/artifacts/a/demo/main.css"))
                    (source / "app.js").write_text("live edit")
                    self.assertEqual(get("/artifacts/a/demo/app.js"), "live edit")
                    with self.assertRaises(HTTPError) as error:
                        get("/artifacts/a/demo/secret.txt")
                    self.assertEqual(error.exception.code, 404)

                    with urlopen(address + "/artifacts/events", timeout=4) as stream:
                        def next_event():
                            lines = []
                            while True:
                                line = stream.readline()
                                if not line:
                                    self.fail("SSE connection ended before refresh")
                                lines.append(line)
                                if not line.strip() and any(b"catalog-changed" in value for value in lines):
                                    return b"".join(lines)
                        self.assertIn(b"refresh", next_event())
                        cli("update", "demo", "--description", "Updated")
                        self.assertIn(b"refresh", next_event())

                    self.assertIn("Updated", get("/artifacts/"))
                    (source / "report.md").write_text("# Report\n\n![Image](chart.png)")
                    (source / "chart.png").write_bytes(b"trusted extension")
                    cli("replace-files", "demo", "--root", str(source), "--entry", "report.md", "--file", "chart.png")
                    self.assertIn("<h1>Report</h1>", get("/artifacts/a/demo/"))
                    with self.assertRaises(HTTPError) as error:
                        get("/artifacts/a/demo/app.js")
                    self.assertEqual(error.exception.code, 404)
                    cli("deregister", "demo")
                    self.assertEqual(json.loads(get("/artifacts/catalog")), {"artifacts": []})
                    with self.assertRaises(HTTPError) as error:
                        get("/artifacts/a/demo/")
                    self.assertEqual(error.exception.code, 404)
                    self.assertTrue((source / "index.html").exists())
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
