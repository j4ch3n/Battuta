"""Dev worker waits for the authenticated assignment route, without running work."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import threading
import unittest

ROOT = Path(__file__).resolve().parents[3]


class ServiceReadinessTests(unittest.TestCase):
    def test_worker_starts_only_after_ready_and_never_after_timeout(self):
        for statuses, started in (([503, 405], True), ([401, 401], False), ([404, 404], False)):
            with self.subTest(statuses=statuses):
                requests = []

                class Handler(BaseHTTPRequestHandler):
                    def do_GET(self):
                        requests.append((self.path, self.headers.get("apikey")))
                        self.send_response(statuses[min(len(requests) - 1, len(statuses) - 1)])
                        self.end_headers()

                    def log_message(self, *_args):
                        pass

                server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    module = (ROOT / "scripts/bot_setup/wait-for-assignments.mjs").as_uri()
                    code = f'''
import {{ waitForAssignments }} from {module!r};
try {{
  await waitForAssignments(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, 2);
  console.log("worker-started");
}} catch (error) {{
  console.error(error.message);
  process.exitCode = 1;
}}
'''
                    result = subprocess.run(["node", "--input-type=module", "-e", code],
                                            env={**os.environ, "SUPABASE_URL": f"http://127.0.0.1:{server.server_port}",
                                                 "SUPABASE_SECRET_KEY": "private-sentinel"},
                                            capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0 if started else 1, result.stderr)
                    self.assertEqual("worker-started" in result.stdout, started)
                    self.assertEqual(requests, [("/functions/v1/assignments", "private-sentinel")] * 2)
                    self.assertNotIn("private-sentinel", result.stdout + result.stderr)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
