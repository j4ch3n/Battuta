"""Memory reads: fixed failure categories and the printed overview lines."""

import json
import unittest
from unittest.mock import patch

import httpx
from click.testing import CliRunner

from battuta_project import memory
from battuta_project.cli import main
from project_fixtures import ProjectTestCase


def reply(data, ok=True):
    envelope = {"ok": True, "data": data} if ok else {"ok": False, "error": {"code": "invalid_request", "message": "x"}}
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": envelope}})


def failing(error):
    def handler(request):
        raise error
    return handler


class TransportTests(unittest.TestCase):
    def test_failures_map_to_fixed_categories(self):
        cases = {
            "unreachable": failing(httpx.ConnectError("refused http://secret@host")),
            "timed out": failing(httpx.ReadTimeout("slow")),
            "rejected": lambda request: httpx.Response(401),
            "server error 500": lambda request: httpx.Response(500, text="Traceback /home/owner"),
        }
        for category, handler in cases.items():
            with self.subTest(category=category), self.assertRaises(memory.MemoryUnavailable) as raised:
                memory.overview("mocktest", httpx.MockTransport(handler))
            self.assertEqual(str(raised.exception), category)

    def test_contract_mismatch_is_rejected(self):
        for response in (httpx.Response(200, text="not json"), reply({"status": "odd"}), reply({}, ok=False)):
            with self.subTest(response=response.content[:20]), self.assertRaisesRegex(memory.MemoryUnavailable, "^rejected$"):
                memory.overview("mocktest", httpx.MockTransport(lambda request, response=response: response))

    def test_sends_one_tool_call_to_the_read_endpoint(self):
        seen = []

        def handler(request):
            seen.append((str(request.url), json.loads(request.content)))
            return reply({"descriptions": {"mocktest": "Banking prototype"}})

        with patch.dict("os.environ", {"BATTUTA_MEMORY_URL": "http://127.0.0.1:9999/mcp"}, clear=False):
            self.assertEqual(memory.descriptions(["mocktest"], httpx.MockTransport(handler)), {"mocktest": "Banking prototype"})
        self.assertEqual(seen[0][0], "http://127.0.0.1:9999/mcp/read")
        self.assertEqual(seen[0][1]["params"], {"name": "memory_project_descriptions", "arguments": {"projects": ["mocktest"]}})


class OutputTests(ProjectTestCase):
    def invoke(self, *args):
        result = CliRunner().invoke(main, list(args), env={"LINEAR_API_TOKEN": "fixture"})
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

    def test_explain_prints_each_overview_result(self):
        cases = [
            ({"status": "ok", "overview": {"body": "Atlas imports maps.", "created": "2026-11-26T05:31:00+00:00"}},
             "Atlas imports maps.\n\n(memory overview, written 2026-11-26)"),
            ({"status": "not_written"}, "Project overview: not written yet."),
            ({"status": "unknown_project", "projects": []}, "Project overview: memory doesn't know this project."),
            (memory.MemoryUnavailable("timed out"), "Project overview: memory query failed (timed out)."),
        ]
        for result, line in cases:
            with self.subTest(line=line):
                self.memory.side_effect = result if isinstance(result, Exception) else None
                self.memory.return_value = result
                output = self.invoke("explain", "atlas-api")
                self.assertIn(line, output)
                self.assertIn("Directory tree", output)

    def test_list_shows_descriptions_and_failure_line(self):
        self.memory.side_effect = None
        self.memory.return_value = {"descriptions": {"atlas-api": "Map import service"}}
        output = self.invoke("list")
        self.assertIn("**atlas-api** — Map import service", output)
        self.assertIn("Run `battuta-project explain <name>` for the full overview.", output)
        self.memory.return_value = {"descriptions": {"atlas-api": None}}
        self.assertIn("**atlas-api** — (no description yet)", self.invoke("list"))
        self.memory.side_effect = memory.MemoryUnavailable("unreachable")
        output = self.invoke("list")
        self.assertIn("**atlas-api**\n", output)
        self.assertIn("Descriptions: memory query failed (unreachable)", output)
        self.assertEqual(json.loads(self.invoke("list", "--json")), {"projects": ["atlas-api"]})


if __name__ == "__main__":
    unittest.main()
