import unittest
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock
from mcp.shared.memory import create_connected_server_and_client_session
from battuta_memory.server import create_protocol_server


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_known_memory_conflict_is_actionable_without_exposing_unknown_errors(self):
        service = SimpleNamespace(get=AsyncMock(side_effect=ValueError("Memory changed since inventory")))
        async with create_connected_server_and_client_session(create_protocol_server(lambda: service)) as client:
            result = await client.call_tool("memory_get", {"ref": "a" * 64})
            self.assertEqual(result.structuredContent["error"]["message"], "Memory changed since inventory")
            self.assertFalse(result.structuredContent["error"]["retryable"])

    async def test_public_records_translate_only_typed_memberships(self):
        record = {"ref": "a" * 64, "scope": {"projects": ["atlas"]},
            "metadata": {"scope": "user supplied"}, "revision": "b" * 64}
        service = SimpleNamespace(
            get=AsyncMock(return_value={**record, "history": [record], "validation_evidence": [record]}),
            recall=AsyncMock(return_value={"context": "Qualified evidence", "records": [record], "validation_evidence": [record]}),
            inventory=AsyncMock(return_value={"records": [record]}))
        async with create_connected_server_and_client_session(create_protocol_server(lambda: service)) as client:
            result = (await client.call_tool("memory_get", {"ref": "a" * 64, "include_history": True})).structuredContent["data"]
            self.assertEqual(result["projects"], ["atlas"])
            self.assertNotIn("scope", result)
            self.assertEqual(result["history"][0]["projects"], ["atlas"])
            self.assertEqual(result["validation_evidence"][0]["projects"], ["atlas"])
            self.assertNotIn("scope", result["validation_evidence"][0])
            self.assertEqual(result["metadata"], {"scope": "user supplied"})
            self.assertEqual(record["scope"], {"projects": ["atlas"]})
            recalled = (await client.call_tool("memory_recall", {"keywords": ["note"], "limit": 10, "max_distance": 0.9})).structuredContent["data"]
            self.assertEqual(recalled["validation_evidence"][0]["projects"], ["atlas"])
            self.assertNotIn("scope", recalled["validation_evidence"][0])

    async def test_flat_tools_and_structured_errors(self):
        service = SimpleNamespace(recall=AsyncMock(side_effect=RuntimeError("private content must not leak")),
            adapter=SimpleNamespace(health=AsyncMock(return_value={"ready": True})))
        server = create_protocol_server(lambda: service)
        async with create_connected_server_and_client_session(server) as client:
            tools = (await client.list_tools()).tools
            self.assertEqual({t.name for t in tools}, {"memory_" + n for n in ("remember", "recall", "list", "get", "update", "link_projects", "forget", "capture", "health", "inventory", "cluster", "consolidate_global", "global_relationships", "set_cues", "cue_targets")})
            recall_schema = next(t for t in tools if t.name == "memory_recall").inputSchema
            self.assertIn("semantic_query", recall_schema["properties"])
            self.assertTrue({"limit", "max_distance"} <= set(recall_schema.get("required", [])))
            health = await client.call_tool("memory_health", {})
            self.assertTrue(health.structuredContent["data"]["ready"])
            failure = await client.call_tool("memory_recall", {"semantic_query": "note", "limit": 10, "max_distance": 0.9})
            self.assertTrue(failure.isError)
            self.assertFalse(failure.structuredContent["ok"])
            self.assertNotIn("private content", str(failure))
            service.recall.side_effect = sqlite3.OperationalError("database locked")
            failure = await client.call_tool("memory_recall", {"semantic_query": "note", "limit": 10, "max_distance": 0.9})
            self.assertIsNotNone(failure.structuredContent)
            self.assertTrue(failure.structuredContent["error"]["retryable"])
        # A separate client can reconnect to the same server.
        async with create_connected_server_and_client_session(server) as client:
            self.assertFalse((await client.call_tool("memory_health", {})).isError)

    async def test_recall_text_is_rendered_and_machine_envelope_is_preserved(self):
        service = SimpleNamespace(recall=AsyncMock(return_value={"context": "- Qualified attributed evidence", "records": [{"ref": "a" * 64}], "status": "partial", "omitted_refs": ["b" * 64]}))
        async with create_connected_server_and_client_session(create_protocol_server(lambda: service)) as client:
            result = await client.call_tool("memory_recall", {"keywords": ["console"], "limit": 10, "max_distance": 0.9})
            self.assertFalse(result.isError)
            self.assertEqual(result.content[0].text, "- Qualified attributed evidence")
            self.assertEqual(result.structuredContent["data"]["records"][0]["ref"], "a" * 64)
            self.assertEqual(result.structuredContent["data"]["status"], "partial")
            self.assertEqual(result.structuredContent["data"]["omitted_refs"], ["b" * 64])
            self.assertNotIn("incomplete", result.structuredContent["data"])

    async def test_cue_tools_dispatch_to_the_service(self):
        record = {"ref": "a" * 64, "scope": {"projects": ["atlas"]}, "revision": "b" * 64}
        service = SimpleNamespace(set_cues=AsyncMock(return_value={"ref": "a" * 64, "cues": 1}),
            cue_targets=AsyncMock(return_value={"records": [record]}))
        async with create_connected_server_and_client_session(create_protocol_server(lambda: service)) as client:
            targets = (await client.call_tool("memory_cue_targets", {"limit": 5})).structuredContent["data"]
            self.assertEqual(targets["records"][0]["projects"], ["atlas"])
            self.assertEqual(service.cue_targets.await_args.args[0].limit, 5)
            args = {"ref": "a" * 64, "expected_revision": "b" * 64, "cues": [{"angle": "task", "text": "I need to plan"}]}
            result = (await client.call_tool("memory_set_cues", args)).structuredContent["data"]
            self.assertEqual(result, {"ref": "a" * 64, "cues": 1})
            self.assertEqual(service.set_cues.await_args.args[0].cues[0].angle, "task")
