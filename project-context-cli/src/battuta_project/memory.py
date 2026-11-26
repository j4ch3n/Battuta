"""Read project overviews from the memory service's read-only endpoint."""

import json
import os

import httpx

TIMEOUT_SECONDS = 5.0


class MemoryUnavailable(Exception):
    """A fixed failure category; never raw error text, so no URLs or tokens reach bot context."""


def read_url() -> str:
    if url := os.environ.get("BATTUTA_MEMORY_READ_URL"):
        return url
    return os.environ.get("BATTUTA_MEMORY_URL", "http://127.0.0.1:8901/mcp").rstrip("/") + "/read"


def _call(name: str, arguments: dict, transport: httpx.BaseTransport | None = None) -> dict:
    request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    headers = {"accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18"}
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            response = client.post(read_url(), json=request, headers=headers)
    except httpx.TimeoutException as error:
        raise MemoryUnavailable("timed out") from error
    except httpx.HTTPError as error:
        raise MemoryUnavailable("unreachable") from error
    if response.status_code in {401, 403, 404, 405, 406, 415}:
        raise MemoryUnavailable("rejected")
    if response.status_code >= 400:
        raise MemoryUnavailable(f"server error {response.status_code}")
    try:
        envelope = response.json()["result"]["structuredContent"]
        if not envelope["ok"]:
            raise MemoryUnavailable("rejected")
        return envelope["data"]
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise MemoryUnavailable("rejected") from error


def overview(project: str, transport: httpx.BaseTransport | None = None) -> dict:
    data = _call("memory_project_overview", {"project": project}, transport)
    if data.get("status") not in {"ok", "not_written", "unknown_project"}:
        raise MemoryUnavailable("rejected")
    return data


def descriptions(projects: list[str], transport: httpx.BaseTransport | None = None) -> dict[str, str | None]:
    data = _call("memory_project_descriptions", {"projects": projects}, transport)
    if not isinstance(data.get("descriptions"), dict):
        raise MemoryUnavailable("rejected")
    return data["descriptions"]
