import asyncio
import socket

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import uvicorn

from battuta_speech.server import create_mcp_app, dispatch
from battuta_speech.service import SpeechService


class Engine:
    def transcribe(self, audio):
        return "hello"

    def synthesize(self, text):
        return b"ogg"


def test_dispatch_returns_transcript_and_ogg():
    service = SpeechService(Engine())
    stt = asyncio.run(dispatch(service, "transcribe_audio", {"audio": "YQ=="}))
    tts = asyncio.run(dispatch(service, "synthesize_speech", {"text": "hello"}))
    assert stt["transcript"] == "hello"
    assert tts == {"audio": "b2dn", "mime_type": "audio/ogg"}


def test_dispatch_rejects_unexpected_arguments():
    service = SpeechService(Engine())
    try:
        asyncio.run(dispatch(service, "transcribe_audio", {"audio": "YQ==", "path": "/secret"}))
    except ValueError:
        return
    assert False, "unexpected arguments accepted"


def test_two_mcp_clients_share_engine():
    async def run():
        created = []

        def factory():
            engine = Engine()
            created.append(engine)
            return engine

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(create_mcp_app(factory), log_level="error"))
        task = asyncio.create_task(server.serve(sockets=[sock]))
        try:
            async with asyncio.timeout(10):
                while not server.started:
                    if task.done():
                        await task
                        raise AssertionError("server stopped before startup")
                    await asyncio.sleep(0.01)
            url = f"http://127.0.0.1:{port}/mcp"
            async with streamablehttp_client(url) as (a_read, a_write, _), streamablehttp_client(url) as (b_read, b_write, _):
                async with ClientSession(a_read, a_write) as a, ClientSession(b_read, b_write) as b:
                    await asyncio.gather(a.initialize(), b.initialize())
                    tools = await a.list_tools()
                    assert {tool.name for tool in tools.tools} == {"transcribe_audio", "synthesize_speech"}
                    result = await b.call_tool("transcribe_audio", {"audio": "YQ=="})
                    assert result.structuredContent == {"transcript": "hello"}
                    assert len(created) == 1
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, 10)
            sock.close()

    asyncio.run(run())
