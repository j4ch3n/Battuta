import json
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import anyio
from mcp import types
from mcp.server.fastmcp.server import StreamableHTTPASGIApp
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from .archive import ingest
from .dream import DreamState, catalog_from_cli, start_dream
from .reads import Reads

MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
STRING_LIST = {"type": "array", "items": {"type": "string"}}
EMPTY = {"type": "object", "properties": {}, "additionalProperties": False}

TOOLS = {
    "recall": ("Recall memories. Pick projects from the project list (global is the owner's personal scope; add it only when relevant) and types from memory_types. "
               "projects only: each project's overview. projects + query: search within those projects, optionally narrowed by types. query only: search everything.",
               {"type": "object", "properties": {"projects": STRING_LIST, "types": STRING_LIST, "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30}}, "additionalProperties": False}),
    "types": ("List the memory types and when each is written, for choosing recall types.", EMPTY),
    "project_overview": ("Read one project's overview. Status ok, not_written, or unknown_project with the valid projects.",
                         {"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"], "additionalProperties": False}),
    "project_descriptions": ("One-line descriptions for the requested (or all) projects; null when no overview exists yet.",
                             {"type": "object", "properties": {"projects": STRING_LIST}, "additionalProperties": False}),
    "profile": ("Read the owner card body (the global overview).", EMPTY),
    "dream_start": ("Start the nightly memory dream in the background after conversation was uploaded.", EMPTY),
    "dream_status": ("Report the current or last dream run, including last_success_at.", EMPTY),
    "health": ("Check that the memory store is ready.", EMPTY),
}
READ_TOOLS = ("recall", "types", "project_overview", "project_descriptions")


class MemoryApi:
    def __init__(self, config, store):
        self.config, self.store, self.reads = config, store, Reads(store)

    def refresh_catalog(self):
        from .store import write_catalog
        projects = catalog_from_cli()
        if projects is not None:
            write_catalog(self.store.root, [name for name in projects if name != "global"])

    def call(self, name: str, arguments: dict):
        if name == "recall":
            return self.reads.recall(arguments.get("projects"), arguments.get("types"), arguments.get("query"), int(arguments.get("limit") or 10))
        if name == "types":
            return {"types": self.reads.types()}
        if name == "project_overview":
            result = self.reads.project_overview(str(arguments.get("project") or ""))
            if result["status"] == "unknown_project":
                self.refresh_catalog()
                result = self.reads.project_overview(str(arguments.get("project") or ""))
            return result
        if name == "project_descriptions":
            return self.reads.project_descriptions(arguments.get("projects"))
        if name == "profile":
            return self.reads.profile()
        if name == "dream_start":
            return start_dream(self.config)
        if name == "dream_status":
            return DreamState(self.store.root).read()
        if name == "health":
            return {"ready": True, "projects": len(self.store.catalog())}
        raise ValueError("Unknown memory tool")


def create_protocol_server(get_api, names=tuple(TOOLS)):
    server = Server("battuta-memory")

    @server.list_tools()
    async def list_tools():
        return [types.Tool(name="memory_" + name, description=TOOLS[name][0], inputSchema=TOOLS[name][1]) for name in names]

    @server.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        short = name.removeprefix("memory_")
        try:
            if name != "memory_" + short or short not in names or not isinstance(arguments or {}, dict):
                raise ValueError("Unknown memory tool")
            data = await anyio.to_thread.run_sync(get_api().call, short, arguments or {})
            payload = {"ok": True, "data": data}
        except ValueError as error:
            payload = {"ok": False, "error": {"code": "invalid_request", "message": str(error)[:300]}}
        except Exception:
            payload = {"ok": False, "error": {"code": "backend_unavailable", "message": "Memory backend unavailable; retry later"}}
        return types.CallToolResult(isError=not payload["ok"], content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
                                    structuredContent=payload)

    return server


def loopback_request(request) -> bool:
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    origin = request.headers.get("origin")
    return host in LOOPBACK and (origin is None or urlsplit(origin).hostname in LOOPBACK)


def create_app(config, open_store):
    """open_store() -> BattutaStore; injected so tests run without the ONNX model."""
    holder = {}
    security = TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"], allowed_origins=[])
    full = StreamableHTTPSessionManager(app=create_protocol_server(lambda: holder["api"]), json_response=True, security_settings=security)
    read = StreamableHTTPSessionManager(app=create_protocol_server(lambda: holder["api"], READ_TOOLS), json_response=True, stateless=True,
                                        security_settings=security)

    async def archive(request):
        if not loopback_request(request):
            return JSONResponse({"ok": False, "error": {"code": "forbidden", "message": "Loopback only"}}, status_code=403)
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/x-ndjson":
            return JSONResponse({"ok": False, "error": {"code": "invalid_request", "message": "Use application/x-ndjson"}}, status_code=415)
        body = await request.body()
        if len(body) > MAX_ARCHIVE_BYTES:
            return JSONResponse({"ok": False, "error": {"code": "invalid_request", "message": "Upload too large"}}, status_code=413)
        try:
            result = await anyio.to_thread.run_sync(ingest, holder["api"].store, body)
        except ValueError as error:
            return JSONResponse({"ok": False, "error": {"code": "invalid_request", "message": str(error)}}, status_code=400)
        return JSONResponse({"ok": True, "data": result})

    @asynccontextmanager
    async def lifespan(_app):
        api = MemoryApi(config, open_store())
        await anyio.to_thread.run_sync(api.refresh_catalog)
        holder["api"] = api
        try:
            async with AsyncExitStack() as stack:
                await stack.enter_async_context(full.run())
                await stack.enter_async_context(read.run())
                yield
        finally:
            holder.clear()

    return Starlette(routes=[Route("/mcp", endpoint=StreamableHTTPASGIApp(full)), Route("/mcp/read", endpoint=StreamableHTTPASGIApp(read)),
                             Route("/archive", endpoint=archive, methods=["POST"])], lifespan=lifespan)


def open_store_for(config):
    def open_store():
        from .embedder import load_embedder
        from .layout import initialize_store
        from .store import BattutaStore
        initialize_store(config.store_dir)
        store = BattutaStore(config.store_dir, embedder=load_embedder(Path.home()))
        store.init()
        return store
    return open_store
