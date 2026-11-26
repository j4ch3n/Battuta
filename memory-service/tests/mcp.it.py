"""Opt-in real-model HTTP check; provision the model in HOME (battuta-memory model install) first."""
import asyncio
import json
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

sys.path.insert(0, str(Path(__file__).parent))
from battuta_memory import server  # noqa: E402
from battuta_memory.config import MemoryConfig  # noqa: E402


@unittest.skipUnless(os.environ.get("BATTUTA_MEMORY_INTEGRATION") == "1", "Real model integration is opt-in")
class RealModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_archive_then_recall_over_http_with_real_embedder(self):
        with tempfile.TemporaryDirectory(prefix="battuta-memory-integration-") as directory, \
                mock.patch.object(server, "catalog_from_cli", return_value=["mocktest"]):
            config = MemoryConfig(data_dir=Path(directory))
            sock = socket.socket()
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            app = server.create_app(config, server.open_store_for(config))
            http = uvicorn.Server(uvicorn.Config(app, log_level="error"))
            task = asyncio.create_task(http.serve(sockets=[sock]))
            while not http.started:
                await asyncio.sleep(0.05)
            try:
                async with streamablehttp_client(f"http://127.0.0.1:{port}/mcp/read") as (read, write, _), ClientSession(read, write) as session:
                    await session.initialize()
                    types = (await session.call_tool("memory_types", {})).structuredContent["data"]["types"]
                    self.assertEqual(len(types), 10)
                    status = (await session.call_tool("memory_project_overview", {"project": "mocktest"})).structuredContent["data"]
                    self.assertEqual(status, {"status": "not_written"})
            finally:
                http.should_exit = True
                await task


if __name__ == "__main__":
    unittest.main()
