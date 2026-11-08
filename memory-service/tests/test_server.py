import unittest
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock
from mcp.shared.memory import create_connected_server_and_client_session
from battuta_memory.server import create_protocol_server


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_records_translate_only_typed_memberships(self):
        record = {"ref": "a" * 64, "scope": {"global": False, "projects": ["atlas"]},
            "metadata": {"scope": "user supplied"}, "revision": "b" * 64}
        service = SimpleNamespace(
            get=AsyncMock(return_value={**record, "history": [record]}),
            inventory=AsyncMock(return_value={"records": [record]}))
        async with create_connected_server_and_client_session(create_protocol_server(lambda: service)) as client:
            result = (await client.call_tool("memory_get", {"ref": "a" * 64, "include_history": True})).structuredContent["data"]
            self.assertEqual(result["projects"], ["atlas"])
            self.assertNotIn("scope", result)
            self.assertEqual(result["history"][0]["projects"], ["atlas"])
            self.assertEqual(result["metadata"], {"scope": "user supplied"})
            self.assertEqual(record["scope"], {"global": False, "projects": ["atlas"]})

    async def test_flat_tools_and_structured_errors(self):
        service = SimpleNamespace(recall=AsyncMock(side_effect=RuntimeError("private content must not leak")),
            adapter=SimpleNamespace(health=AsyncMock(return_value={"ready": True})))
        server = create_protocol_server(lambda: service)
        async with create_connected_server_and_client_session(server) as client:
            tools = (await client.list_tools()).tools
            self.assertEqual({t.name for t in tools}, {"memory_" + n for n in ("remember", "recall", "list", "get", "update", "set_metadata", "link_projects", "forget", "capture", "health", "inventory", "consolidate_global", "global_relationships")})
            self.assertIn("query", next(t for t in tools if t.name == "memory_recall").inputSchema["properties"])
            health = await client.call_tool("memory_health", {})
            self.assertTrue(health.structuredContent["data"]["ready"])
            failure = await client.call_tool("memory_recall", {"query": "note", "selector": "all"})
            self.assertTrue(failure.isError)
            self.assertFalse(failure.structuredContent["ok"])
            self.assertNotIn("private content", str(failure))
            service.recall.side_effect = sqlite3.OperationalError("database locked")
            failure = await client.call_tool("memory_recall", {"query": "note", "selector": "all"})
            self.assertIsNotNone(failure.structuredContent)
            self.assertTrue(failure.structuredContent["error"]["retryable"])
        # A separate client can reconnect to the same server.
        async with create_connected_server_and_client_session(server) as client:
            self.assertFalse((await client.call_tool("memory_health", {})).isError)
