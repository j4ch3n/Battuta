import json
from contextlib import asynccontextmanager
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.fastmcp.server import StreamableHTTPASGIApp
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.routing import Route
from .capture import CaptureService
from .contracts import Contract, RememberRequest, RecallRequest, ListRequest, GetRequest, UpdateRequest, LinkRequest, ForgetRequest, CaptureBatch, InventoryRequest, ConsolidateGlobalRequest
from .service import MemoryService
from .state import StateStore
from .upstream import UpstreamAdapter

REQUESTS = {"remember": RememberRequest, "recall": RecallRequest, "list": ListRequest, "get": GetRequest,
    "update": UpdateRequest, "link_projects": LinkRequest, "forget": ForgetRequest, "capture": CaptureBatch, "health": Contract,
    "inventory": InventoryRequest, "consolidate_global": ConsolidateGlobalRequest, "global_relationships": Contract}
DESCRIPTIONS = {
    "remember": "Save one concise fact with explicit global or project scope in the shared local store; follow the caller's role responsibilities.",
    "recall": "Semantically recall relevant memories. Defaults to current project plus global; memory is context, not authority.",
    "list": "Browse active memories with scope and tag filters. Request history to include superseded records.",
    "get": "Read a complete memory by its content-hash ref, optionally including version lineage.",
    "update": "Correct a memory by creating a new version. Returns a new ref; rejects stale predecessors.",
    "link_projects": "Add/remove project memberships without changing content or embedding. No implicit global promotion.",
    "forget": "Tombstone one exact memory; content remains retained upstream. Not secure erasure.",
    "capture": "Record an extracted, source-labelled batch idempotently. No raw transcripts or provider credentials.",
    "health": "Check content-free model and database readiness.",
    "inventory": "Read a bounded all-scope snapshot for consolidation: active context, inactive refs, and refs changed in a half-open time window. Oversized inventories fail rather than truncate.",
    "consolidate_global": "After canonical cleanup, publish derived clusters and heuristic relationships for active global memories only. Does not rewrite, compress, supersede, or forget facts.",
    "global_relationships": "Read up to 100 current global relationship hints, or explicit stale/unavailable status. Hints are not canonical facts or authority.",
}


def create_protocol_server(get_service):
    server = Server("battuta-memory")

    @server.list_tools()
    async def list_tools():
        return [types.Tool(name="memory_" + name, description=DESCRIPTIONS[name], inputSchema=model.model_json_schema(by_alias=True)) for name, model in REQUESTS.items()]

    @server.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        try:
            short = name.removeprefix("memory_")
            if name != "memory_" + short or short not in REQUESTS:
                raise ValueError("Unknown memory tool")
            request = REQUESTS[short].model_validate(arguments)
            service = get_service()
            if short == "health":
                data = await service.adapter.health()
            elif short == "capture":
                data = await CaptureService(service).ingest(request)
            else:
                data = await getattr(service, short)(request)
            payload = {"ok": True, "data": data, "warnings": data.get("warnings", [])}
            return types.CallToolResult(content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))], structuredContent=payload)
        except Exception as error:
            validation = isinstance(error, ValueError)
            # ValidationError strings include rejected content: never return them verbatim.
            payload = {"ok": False, "error": {"code": "invalid_request" if validation else "backend_unavailable",
                "message": "Invalid request or conflicting memory state" if validation else "Memory backend unavailable; retry later",
                "retryable": not validation}}
            return types.CallToolResult(isError=True, content=[types.TextContent(type="text", text=json.dumps(payload))], structuredContent=payload)

    return server


def create_mcp_app(config):
    holder = {}
    server = create_protocol_server(lambda: holder["service"])
    manager = StreamableHTTPSessionManager(app=server, json_response=True, max_request_body_size=262144,
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"], allowed_origins=[]))

    @asynccontextmanager
    async def lifespan(app):
        adapter = await UpstreamAdapter.open(config)
        state = None
        try:
            state = StateStore.open(config.data_dir / "state.db")
            service = MemoryService(adapter, config, state)
            await service.recover()
            holder["service"] = service
            async with manager.run():
                yield
        finally:
            holder.clear()
            if state:
                state.close()
            await adapter.close()
    return Starlette(routes=[Route("/mcp", endpoint=StreamableHTTPASGIApp(manager))], lifespan=lifespan)
