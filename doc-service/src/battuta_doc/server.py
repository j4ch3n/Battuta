"""Host-local Streamable HTTP MCP server."""

import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path

import click
from mcp import types
from mcp.server.fastmcp.server import StreamableHTTPASGIApp
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
import uvicorn

from .config import DocError, Settings, resolve_source
from .options import ConvertOptions

CONVERT_KEYS = {"source", "pages", "ocr", "ocr_languages", "tables", "figures", "charts", "formulas"}
SWEEP_SECONDS = 86400

CONVERT_DESCRIPTION = (
    "Convert a local document (PDF, DOCX, images) to Markdown with tables, OCR text, extracted figures and chart data. "
    "Blocks until finished. Results are files in the returned output_dir: read INDEX.md first. "
    "If it returns status \"running\", call doc_convert again with identical arguments to keep waiting; "
    "the same job is joined, never restarted. doc_job never waits."
)


def _schema(properties: dict, required=()) -> dict:
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


TOOLS = [
    types.Tool(name="doc_convert", description=CONVERT_DESCRIPTION, inputSchema=_schema({
        "source": {"type": "string", "description": "Absolute path to a local file under an allowed input root"},
        "pages": {"type": "string", "description": "Page spec such as \"1-5,9\"; default all pages"},
        "ocr": {"type": "string", "enum": ["auto", "off", "force"], "default": "auto"},
        "ocr_languages": {"type": "array", "items": {"type": "string"}, "description": "ISO language codes"},
        "tables": {"type": "string", "enum": ["off", "fast", "accurate"], "default": "accurate"},
        "figures": {"type": "string", "enum": ["off", "extract", "describe"], "default": "extract"},
        "charts": {"type": "boolean", "default": True, "description": "Extract chart data to CSV"},
        "formulas": {"type": "boolean", "default": False},
    }, ["source"])),
    types.Tool(name="doc_job", description="Report the progress or final result of a conversion by doc_id. Never waits.",
               inputSchema=_schema({"doc_id": {"type": "string"}}, ["doc_id"])),
    types.Tool(name="doc_page_image", description="Render one page of a converted PDF to a PNG to check tables, OCR or charts visually.",
               inputSchema=_schema({"doc_id": {"type": "string"}, "page": {"type": "integer", "minimum": 1},
                                    "scale": {"type": "number", "default": 1.5, "maximum": 3}}, ["doc_id", "page"])),
    types.Tool(name="doc_service_status", description="Report readiness, models, running and queued jobs, cache size and limits.",
               inputSchema=_schema({})),
    types.Tool(name="doc_list", description="List converted documents kept by the service.", inputSchema=_schema({})),
    types.Tool(name="doc_delete", description="Delete one converted document by doc_id, or all older than N days. Give exactly one.",
               inputSchema=_schema({"doc_id": {"type": "string"}, "older_than_days": {"type": "integer", "minimum": 0}})),
]


def result_payload(status) -> dict:
    base = {"doc_id": status.doc_id, "status": status.status}
    if status.status == "done":
        return base | (status.result or {}) | {
            "next_step": "Read INDEX.md in output_dir first; its page-to-line table maps pages to lines of document.md."}
    if status.status == "failed":
        return base | {"stage": status.stage, "code": status.code, "message": status.message,
                       "next_step": "Fix the cause, then call doc_convert again; a failed job is rerun."}
    return base | {"stage": status.stage, "pages_done": status.pages_done, "pages_total": status.pages_total,
                   "elapsed_seconds": status.elapsed_seconds,
                   "next_step": "Still running: call doc_convert again with identical arguments to keep waiting."}


def _only(arguments: dict, allowed: set[str]) -> None:
    extra = set(arguments) - allowed
    if extra:
        raise DocError("invalid_option", f"unexpected arguments: {', '.join(sorted(extra))}")


async def dispatch(name: str, arguments: dict, *, settings: Settings, jobs, models, heartbeat=None) -> list[types.TextContent]:
    async def silent(status):
        pass

    if name == "doc_convert":
        _only(arguments, CONVERT_KEYS)
        if "source" not in arguments:
            raise DocError("invalid_option", "source is required")
        source = resolve_source(settings, str(arguments["source"]))
        options = ConvertOptions.from_args(**{k: v for k, v in arguments.items() if k != "source"})
        data = result_payload(await jobs.convert(source, options, heartbeat or silent))
    elif name == "doc_job":
        _only(arguments, {"doc_id"})
        data = result_payload(jobs.job(str(arguments.get("doc_id", ""))))
    elif name == "doc_page_image":
        _only(arguments, {"doc_id", "page", "scale"})
        path = await asyncio.to_thread(jobs.page_image, str(arguments.get("doc_id", "")), arguments.get("page"),
                                       arguments.get("scale", 1.5))
        data = {"path": str(path)}
    elif name == "doc_service_status":
        _only(arguments, set())
        data = {**models.health(), "jobs": jobs.queue_state(), "cache_bytes": sum(r["bytes"] for r in jobs.list()),
                "limits": {"max_bytes": settings.max_bytes, "max_pages": settings.max_pages, "max_wait_seconds": settings.max_wait,
                           "job_timeout_seconds": settings.job_timeout, "max_queue": settings.max_queue,
                           "retention_days": settings.retention_days}}
    elif name == "doc_list":
        _only(arguments, set())
        data = {"documents": jobs.list()}
    elif name == "doc_delete":
        _only(arguments, {"doc_id", "older_than_days"})
        if ("doc_id" in arguments) == ("older_than_days" in arguments):
            raise DocError("invalid_option", "give exactly one of doc_id or older_than_days")
        if "doc_id" in arguments:
            jobs.delete(str(arguments["doc_id"]))
            data = {"deleted": 1}
        else:
            data = {"deleted": jobs.sweep(int(arguments["older_than_days"]))}
    else:
        raise DocError("unknown_tool", f"unknown tool {name}")
    return [types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))]


def create_mcp_app(settings: Settings, jobs, models) -> Starlette:
    protocol = Server("battuta-doc")

    @protocol.list_tools()
    async def list_tools():
        return TOOLS

    @protocol.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        ctx = protocol.request_context
        token = ctx.meta.progressToken if ctx.meta else None
        beats = 0

        async def heartbeat(status):
            nonlocal beats
            beats += 1
            if token is not None:
                await ctx.session.send_progress_notification(
                    token, status.elapsed_seconds + beats, message=f"{status.stage} {status.pages_done}/{status.pages_total}",
                    related_request_id=ctx.request_id)

        try:
            content = await dispatch(name, arguments or {}, settings=settings, jobs=jobs, models=models, heartbeat=heartbeat)
            return types.CallToolResult(content=content)
        except DocError as error:
            body = {"code": error.code, "message": error.message, **error.data}
        except Exception:
            body = {"code": "internal_error", "message": "document service failed; retry later"}
        return types.CallToolResult(isError=True, content=[types.TextContent(type="text", text=json.dumps(body))])

    manager = StreamableHTTPSessionManager(
        app=protocol, json_response=False,
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"], allowed_origins=[]),
    )

    async def sweeper():
        while True:
            await asyncio.to_thread(jobs.sweep)
            await asyncio.sleep(SWEEP_SECONDS)

    @asynccontextmanager
    async def lifespan(app):
        await asyncio.to_thread(jobs.recover)
        tasks = [asyncio.create_task(asyncio.to_thread(models.ensure)), asyncio.create_task(sweeper())]
        try:
            async with manager.run():
                yield
        finally:
            for task in tasks:
                task.cancel()

    async def health(request):
        state = models.health()
        return JSONResponse(state, status_code=200 if state["ready"] else 503)

    return Starlette(routes=[Route("/mcp", endpoint=StreamableHTTPASGIApp(manager)), Route("/health", endpoint=health)],
                     lifespan=lifespan)


def build_runtime(settings: Settings):
    from .converter import DoclingConverter
    from .jobs import JobManager
    from .models import ModelManager, docling_downloader

    models = ModelManager(settings.data_dir, docling_downloader)
    return JobManager(settings, DoclingConverter(settings, models.models_dir), models), models


@click.group(invoke_without_command=True)
@click.pass_context
def main(ctx):
    """Run the local document parsing MCP service."""
    os.umask(0o077)
    if ctx.invoked_subcommand is None:
        settings = Settings.from_env()
        jobs, models = build_runtime(settings)
        uvicorn.run(create_mcp_app(settings, jobs, models), host="127.0.0.1", port=8903, access_log=False)


@main.command("install-models")
def install_models():
    """Download all required models now (idempotent)."""
    from .models import ModelManager, docling_downloader

    models = ModelManager(Settings.from_env().data_dir, docling_downloader)
    models.ensure()
    health = models.health()
    if not health["ready"]:
        raise click.ClickException(health["error"] or "model download failed")
    click.echo("models ready")
