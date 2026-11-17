"""Host-local Streamable HTTP MCP server."""

import asyncio
import base64
from contextlib import asynccontextmanager
import json
from pathlib import Path

import click
from mcp import types
from mcp.server.fastmcp.server import StreamableHTTPASGIApp
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route
import uvicorn

from .service import SpeechService


async def dispatch(service, name, arguments):
    if name == "transcribe_audio" and set(arguments) == {"audio"} and isinstance(arguments["audio"], str):
        return {"transcript": await asyncio.to_thread(service.transcribe, arguments["audio"])}
    if name == "synthesize_speech" and set(arguments) == {"text"} and isinstance(arguments["text"], str):
        audio = await asyncio.to_thread(service.synthesize, arguments["text"])
        return {"audio": base64.b64encode(audio).decode("ascii"), "mime_type": "audio/ogg"}
    raise ValueError("Invalid speech request")


def create_mcp_app(engine_factory):
    holder = {}
    protocol = Server("battuta-speech")

    @protocol.list_tools()
    async def list_tools():
        return [
            types.Tool(name="transcribe_audio", description="Transcribe base64-encoded audio.", inputSchema={
                "type": "object", "properties": {"audio": {"type": "string", "description": "Base64-encoded audio"}}, "required": ["audio"], "additionalProperties": False}),
            types.Tool(name="synthesize_speech", description="Synthesize English text as base64 OGG/Opus.", inputSchema={
                "type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"], "additionalProperties": False}),
        ]

    @protocol.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        try:
            data = await dispatch(holder["service"], name, arguments or {})
            return types.CallToolResult(content=[types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))], structuredContent=data)
        except ValueError as error:
            return types.CallToolResult(isError=True, content=[types.TextContent(type="text", text=str(error))])
        except Exception:
            return types.CallToolResult(isError=True, content=[types.TextContent(type="text", text="Speech service failed or is busy; retry later")])

    manager = StreamableHTTPSessionManager(
        app=protocol, json_response=True, max_request_body_size=14_100_000,
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"], allowed_origins=[]),
    )

    @asynccontextmanager
    async def lifespan(app):
        holder["service"] = SpeechService(await asyncio.to_thread(engine_factory))
        try:
            async with manager.run():
                yield
        finally:
            holder.clear()

    async def health(request):
        return JSONResponse({"ready": "service" in holder}, status_code=200 if "service" in holder else 503)

    async def tts(request):
        service = holder.get("service")
        if service is None:
            return PlainTextResponse("Speech service is not ready", status_code=503)
        body = await request.body()
        if len(body) > 16_384:
            return PlainTextResponse("Text is empty or too long", status_code=413)
        try:
            audio = await asyncio.to_thread(service.synthesize, body.decode("utf-8"))
        except UnicodeDecodeError:
            return PlainTextResponse("Text must be UTF-8", status_code=400)
        except ValueError as error:
            return PlainTextResponse(str(error), status_code=400)
        except RuntimeError as error:
            return PlainTextResponse(str(error), status_code=503)
        return Response(audio, media_type="audio/ogg")

    return Starlette(routes=[Route("/mcp", endpoint=StreamableHTTPASGIApp(manager)), Route("/health", endpoint=health), Route("/tts", endpoint=tts, methods=["POST"])], lifespan=lifespan)


@click.command()
def main():
    """Run the local speech MCP service."""
    from .engines import SpeechEngine

    root = Path.home() / ".battuta/speech-service"
    uvicorn.run(create_mcp_app(lambda: SpeechEngine(root)), host="127.0.0.1", port=8902, access_log=False)
