import asyncio
import json
from unittest import mock

import pytest
from mcp.shared.memory import create_connected_server_and_client_session
from starlette.testclient import TestClient

from battuta_memory import server
from battuta_memory.config import MemoryConfig
from helpers import entity

LINE = json.dumps({"entry_id": "a", "conversation_id": "c", "speaker": "owner", "text": "hi", "timestamp": "2026-11-26T09:00:00Z"})
MCP_HEADERS = {"accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18"}


@pytest.fixture
def client(store, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "catalog_from_cli", lambda *args, **kwargs: None)
    config = MemoryConfig(data_dir=tmp_path / "data")
    with TestClient(server.create_app(config, lambda: store), base_url="http://127.0.0.1:8901") as client:
        yield client


def rpc(client, path, method, params=None, headers=None):
    return client.post(path, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
                       headers={**MCP_HEADERS, **(headers or {})})


def test_read_endpoint_lists_only_read_tools_and_answers_single_post(client):
    tools = {tool["name"] for tool in rpc(client, "/mcp/read", "tools/list").json()["result"]["tools"]}
    assert tools == {"memory_recall", "memory_types", "memory_project_overview", "memory_project_descriptions"}
    reply = rpc(client, "/mcp/read", "tools/call", {"name": "memory_project_overview", "arguments": {"project": "mocktest"}}).json()
    assert reply["result"]["structuredContent"] == {"ok": True, "data": {"status": "not_written"}}
    refused = rpc(client, "/mcp/read", "tools/call", {"name": "memory_dream_start", "arguments": {}}).json()
    assert refused["result"]["structuredContent"]["error"]["code"] == "invalid_request"


def test_forget_is_on_full_endpoint_only(client, store):
    slug = store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client")).name
    tools = {tool["name"] for tool in rpc(client, "/mcp/read", "tools/list").json()["result"]["tools"]}
    assert "memory_forget" not in tools
    arguments = {"entries": [{"slug": slug}], "reason": "obsolete", "owner_confirmation": "owner said so"}
    refused = rpc(client, "/mcp/read", "tools/call", {"name": "memory_forget", "arguments": arguments}).json()
    assert refused["result"]["structuredContent"]["error"]["code"] == "invalid_request"
    assert store.find(slug).is_active()
    init = rpc(client, "/mcp", "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    session = {"mcp-session-id": init.headers["mcp-session-id"]}
    client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers={**MCP_HEADERS, **session})
    full_tools = {tool["name"] for tool in rpc(client, "/mcp", "tools/list", headers=session).json()["result"]["tools"]}
    assert "memory_forget" in full_tools
    reply = rpc(client, "/mcp", "tools/call", {"name": "memory_forget", "arguments": arguments}, headers=session).json()
    result = reply["result"]["structuredContent"]
    assert result["ok"], result
    assert result["data"]["results"][0]["result"] == "forgotten"
    assert not store.find(slug).is_active()
    invalid = rpc(client, "/mcp", "tools/call", {"name": "memory_forget", "arguments": {"entries": [{"slug": slug}]}}, headers=session).json()
    assert invalid["result"]["structuredContent"]["error"]["code"] == "invalid_request"


def test_archive_route_ingests_and_rejects(client):
    ok = client.post("/archive", content=LINE + "\n", headers={"content-type": "application/x-ndjson"})
    assert ok.json()["data"]["days"]["cos-2026-11-26"]["appended"] == 1
    bad = client.post("/archive", content="{bad\n", headers={"content-type": "application/x-ndjson"})
    assert (bad.status_code, bad.json()["error"]["message"]) == (400, "line 1: not JSON")
    assert client.post("/archive", json={"text": "x"}).status_code == 415


@pytest.mark.parametrize("headers", [{"host": "evil.example"}, {"origin": "https://evil.example"}], ids=["foreign-host", "foreign-origin"])
def test_archive_rejects_non_loopback_host_and_origin(client, headers):
    response = client.post("/archive", content=LINE, headers={"content-type": "application/x-ndjson", **headers})
    assert response.status_code == 403


def test_protocol_full_endpoint_tools_and_dream_start(store, tmp_path):
    api = server.MemoryApi(MemoryConfig(data_dir=tmp_path), store)

    async def scenario():
        async with create_connected_server_and_client_session(server.create_protocol_server(lambda: api)) as client:
            names = {tool.name for tool in (await client.list_tools()).tools}
            with mock.patch.object(server, "start_dream", return_value={"status": "already_running"}):
                started = await client.call_tool("memory_dream_start", {})
            return names, started, await client.call_tool("memory_dream_status", {})

    names, started, status = asyncio.run(scenario())
    assert {"memory_dream_start", "memory_dream_status", "memory_profile"} <= names
    assert started.structuredContent["data"] == {"status": "already_running"}
    assert status.structuredContent["data"]["status"] == "idle"


def test_protocol_unexpected_errors_do_not_leak():
    api = mock.Mock()
    api.call.side_effect = RuntimeError("private /home/owner path")

    async def scenario():
        async with create_connected_server_and_client_session(server.create_protocol_server(lambda: api)) as client:
            return await client.call_tool("memory_recall", {"query": "x"})

    result = asyncio.run(scenario())
    assert "private" not in json.dumps(result.structuredContent)
    assert result.structuredContent["error"]["code"] == "backend_unavailable"
