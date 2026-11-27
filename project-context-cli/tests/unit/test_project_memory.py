"""Memory reads: fixed failure categories and the printed overview lines."""

import json

import httpx
import pytest

from battuta_project import memory
from battuta_project.cli import main


def reply(data, ok=True):
    envelope = {"ok": True, "data": data} if ok else {"ok": False, "error": {"code": "invalid_request", "message": "x"}}
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": envelope}})


def failing(error):
    def handler(request):
        raise error
    return handler


@pytest.mark.parametrize("category, handler", [
    ("unreachable", failing(httpx.ConnectError("refused http://secret@host"))),
    ("timed out", failing(httpx.ReadTimeout("slow"))),
    ("rejected", lambda request: httpx.Response(401)),
    ("server error 500", lambda request: httpx.Response(500, text="Traceback /home/owner")),
], ids=["connect-error", "timeout", "unauthorized", "server-error"])
def test_failures_map_to_fixed_categories(category, handler):
    with pytest.raises(memory.MemoryUnavailable) as raised:
        memory.overview("mocktest", httpx.MockTransport(handler))
    assert str(raised.value) == category


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="not json"), reply({"status": "odd"}), reply({}, ok=False),
], ids=["not-json", "unknown-status", "error-envelope"])
def test_contract_mismatch_is_rejected(response):
    with pytest.raises(memory.MemoryUnavailable, match="^rejected$"):
        memory.overview("mocktest", httpx.MockTransport(lambda request: response))


def test_sends_one_tool_call_to_the_read_endpoint(monkeypatch):
    seen = []

    def handler(request):
        seen.append((str(request.url), json.loads(request.content)))
        return reply({"descriptions": {"mocktest": "Banking prototype"}})

    monkeypatch.setenv("BATTUTA_MEMORY_URL", "http://127.0.0.1:9999/mcp")
    assert memory.descriptions(["mocktest"], httpx.MockTransport(handler)) == {"mocktest": "Banking prototype"}
    assert seen[0][0] == "http://127.0.0.1:9999/mcp/read"
    assert seen[0][1]["params"] == {"name": "memory_project_descriptions", "arguments": {"projects": ["mocktest"]}}


@pytest.mark.parametrize("result, line", [
    ({"status": "ok", "overview": {"body": "Atlas imports maps.", "created": "2026-11-26T05:31:00+00:00"}},
     "Atlas imports maps.\n\n(memory overview, written 2026-11-26)"),
    ({"status": "not_written"}, "Project overview: not written yet."),
    ({"status": "unknown_project", "projects": []}, "Project overview: memory doesn't know this project."),
    (memory.MemoryUnavailable("timed out"), "Project overview: memory query failed (timed out)."),
], ids=["written", "not-written", "unknown-project", "unavailable"])
def test_explain_prints_each_overview_result(invoke, project, memory_call, result, line):
    memory_call.side_effect = result if isinstance(result, Exception) else None
    memory_call.return_value = result
    output = invoke("explain", "atlas-api")
    assert line in output
    assert "Directory tree" in output


@pytest.mark.parametrize("descriptions, line", [
    ({"atlas-api": "Map import service"}, "**atlas-api** — Map import service"),
    ({"atlas-api": None}, "**atlas-api** — (no description yet)"),
], ids=["described", "undescribed"])
def test_list_shows_descriptions(invoke, project, memory_call, descriptions, line):
    memory_call.side_effect = None
    memory_call.return_value = {"descriptions": descriptions}
    output = invoke("list")
    assert line in output
    assert "Run `battuta-project explain <name>` for the full overview." in output


def test_list_shows_failure_line_and_json_stays_plain(invoke, project):
    output = invoke("list")
    assert "**atlas-api**\n" in output
    assert "Descriptions: memory query failed (unreachable)" in output
    assert json.loads(invoke("list", "--json")) == {"projects": ["atlas-api"]}
