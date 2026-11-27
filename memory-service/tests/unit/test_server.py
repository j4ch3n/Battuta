import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mcp.shared.memory import create_connected_server_and_client_session
from starlette.testclient import TestClient

from battuta_memory import server
from battuta_memory.config import MemoryConfig
from helpers import entity, make_store

LINE = json.dumps({"entry_id": "a", "conversation_id": "c", "speaker": "owner", "text": "hi", "timestamp": "2026-11-26T09:00:00Z"})


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.config = MemoryConfig(data_dir=Path(directory.name))
        patcher = mock.patch.object(server, "catalog_from_cli", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(server.create_app(self.config, lambda: self.store), base_url="http://127.0.0.1:8901")
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def rpc(self, path, method, params=None, headers=None):
        response = self.client.post(path, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
                                    headers={"accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", **(headers or {})})
        return response

    def test_read_endpoint_lists_only_read_tools_and_answers_single_post(self):
        tools = {tool["name"] for tool in self.rpc("/mcp/read", "tools/list").json()["result"]["tools"]}
        self.assertEqual(tools, {"memory_recall", "memory_types", "memory_project_overview", "memory_project_descriptions"})
        reply = self.rpc("/mcp/read", "tools/call", {"name": "memory_project_overview", "arguments": {"project": "mocktest"}}).json()
        self.assertEqual(reply["result"]["structuredContent"], {"ok": True, "data": {"status": "not_written"}})
        refused = self.rpc("/mcp/read", "tools/call", {"name": "memory_dream_start", "arguments": {}}).json()
        self.assertEqual(refused["result"]["structuredContent"]["error"]["code"], "invalid_request")

    def test_forget_is_on_full_endpoint_only(self):
        slug = self.store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client")).name
        tools = {tool["name"] for tool in self.rpc("/mcp/read", "tools/list").json()["result"]["tools"]}
        self.assertNotIn("memory_forget", tools)
        arguments = {"entries": [{"slug": slug}], "reason": "obsolete", "owner_confirmation": "owner said so"}
        refused = self.rpc("/mcp/read", "tools/call", {"name": "memory_forget", "arguments": arguments}).json()
        self.assertEqual(refused["result"]["structuredContent"]["error"]["code"], "invalid_request")
        self.assertTrue(self.store.find(slug).is_active())
        init = self.rpc("/mcp", "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
        session = {"mcp-session-id": init.headers["mcp-session-id"]}
        self.client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                         headers={"accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", **session})
        full_tools = {tool["name"] for tool in self.rpc("/mcp", "tools/list", headers=session).json()["result"]["tools"]}
        self.assertIn("memory_forget", full_tools)
        reply = self.rpc("/mcp", "tools/call", {"name": "memory_forget", "arguments": arguments}, headers=session).json()
        result = reply["result"]["structuredContent"]
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["results"][0]["result"], "forgotten")
        self.assertFalse(self.store.find(slug).is_active())
        invalid = self.rpc("/mcp", "tools/call", {"name": "memory_forget", "arguments": {"entries": [{"slug": slug}]}}, headers=session).json()
        self.assertEqual(invalid["result"]["structuredContent"]["error"]["code"], "invalid_request")

    def test_archive_route_ingests_and_rejects(self):
        ok = self.client.post("/archive", content=LINE + "\n", headers={"content-type": "application/x-ndjson"})
        self.assertEqual(ok.json()["data"]["days"]["cos-2026-11-26"]["appended"], 1)
        bad = self.client.post("/archive", content="{bad\n", headers={"content-type": "application/x-ndjson"})
        self.assertEqual((bad.status_code, bad.json()["error"]["message"]), (400, "line 1: not JSON"))
        self.assertEqual(self.client.post("/archive", json={"text": "x"}).status_code, 415)

    def test_archive_rejects_non_loopback_host_and_origin(self):
        for headers in ({"host": "evil.example"}, {"origin": "https://evil.example"}):
            with self.subTest(headers=headers):
                response = self.client.post("/archive", content=LINE, headers={"content-type": "application/x-ndjson", **headers})
                self.assertEqual(response.status_code, 403)


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_endpoint_tools_and_dream_start(self):
        store = make_store(self)
        api = server.MemoryApi(MemoryConfig(data_dir=store.root.parent), store)
        async with create_connected_server_and_client_session(server.create_protocol_server(lambda: api)) as client:
            names = {tool.name for tool in (await client.list_tools()).tools}
            self.assertLessEqual({"memory_dream_start", "memory_dream_status", "memory_profile"}, names)
            with mock.patch.object(server, "start_dream", return_value={"status": "already_running"}):
                result = await client.call_tool("memory_dream_start", {})
            self.assertEqual(result.structuredContent["data"], {"status": "already_running"})
            status = await client.call_tool("memory_dream_status", {})
            self.assertEqual(status.structuredContent["data"]["status"], "idle")

    async def test_unexpected_errors_do_not_leak(self):
        api = mock.Mock()
        api.call.side_effect = RuntimeError("private /home/owner path")
        async with create_connected_server_and_client_session(server.create_protocol_server(lambda: api)) as client:
            result = await client.call_tool("memory_recall", {"query": "x"})
        self.assertNotIn("private", json.dumps(result.structuredContent))
        self.assertEqual(result.structuredContent["error"]["code"], "backend_unavailable")


if __name__ == "__main__":
    unittest.main()
