"""Opt-in HTTP/real-model check; provision the model in HOME before running."""
import asyncio
import os
import socket
import sqlite3
import tempfile
import unittest
from pathlib import Path

import uvicorn
import sqlite_vec
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from battuta_memory.config import MemoryConfig
from battuta_memory.server import create_mcp_app


@unittest.skipUnless(os.environ.get("BATTUTA_MEMORY_INTEGRATION") == "1", "Real model integration is opt-in")
class RealModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_clients_share_scoped_versions_and_persist_after_restart(self):
        with tempfile.TemporaryDirectory(prefix="battuta-memory-integration-") as directory:
            root = Path(directory)
            config = MemoryConfig(data_dir=root / "data")
            ref = None
            generation = None
            run_id = "2026-10-21T03:00:00Z"
            for restart in (False, True):
                sock = socket.socket()
                sock.bind(("127.0.0.1", 0))
                server = uvicorn.Server(uvicorn.Config(create_mcp_app(config), log_level="error"))
                task = asyncio.create_task(server.serve(sockets=[sock]))
                try:
                    async with asyncio.timeout(30):
                        while not server.started:
                            if task.done():
                                await task
                                self.fail("Server did not start; check model provisioning")
                            await asyncio.sleep(0.02)
                    url = f"http://127.0.0.1:{sock.getsockname()[1]}/mcp"
                    async with streamablehttp_client(url) as (ar, aw, _), streamablehttp_client(url) as (br, bw, _):
                        async with ClientSession(ar, aw) as cos, ClientSession(br, bw) as other_cos:
                            await asyncio.gather(cos.initialize(), other_cos.initialize())
                            async def call(client, name, **args):
                                result = await client.call_tool("memory_" + name, args)
                                self.assertFalse(result.isError, result.content)
                                return result.structuredContent["data"]
                            self.assertTrue((await call(cos, "health"))["ready"])
                            if restart:
                                self.assertEqual((await call(other_cos, "get", ref=ref))["content"], "Atlas stores project data in SQLite.")
                                self.assertEqual((await call(cos, "consolidate_global", run_id=run_id))["generation_id"], generation)
                                self.assertEqual((await call(cos, "global_relationships"))["status"], "current")
                                continue
                            sources = [{"agent_id": "cos", "session_id": "synthetic-session", "entry_id": "owner-statement"}]
                            first = await call(cos, "remember", content="Atlas stores project data in Postgres.", projects=["Atlas", "My Project", "one,two", "项目"], sources=sources)
                            public = await call(cos, "get", ref=first["ref"])
                            self.assertEqual(public["projects"], ["atlas", "my project", "one,two", "项目"])
                            self.assertNotIn("scope", public)
                            self.assertFalse((root / "projects").exists())
                            personal = await call(cos, "remember", content="The owner prefers concise replies.", projects=["global"], sources=sources)
                            await call(other_cos, "remember", content="Beacon stores project data in Postgres.", projects=["beacon"], sources=sources)
                            with sqlite3.connect(config.database) as db:
                                db.enable_load_extension(True)
                                sqlite_vec.load(db)
                                before = db.execute("SELECT content_embedding FROM memory_embeddings e JOIN memories m ON m.id=e.rowid WHERE content_hash=?", (first["ref"],)).fetchone()[0]
                            await call(cos, "link_projects", ref=first["ref"], add=["beacon"])
                            with sqlite3.connect(config.database) as db:
                                db.enable_load_extension(True)
                                sqlite_vec.load(db)
                                after = db.execute("SELECT content_embedding FROM memory_embeddings e JOIN memories m ON m.id=e.rowid WHERE content_hash=?", (first["ref"],)).fetchone()[0]
                            self.assertEqual(before, after)
                            revised = await call(other_cos, "update", ref=first["ref"], content="Atlas stores project data in SQLite.", reason="Owner correction")
                            ref = revised["ref"]
                            history = await call(cos, "get", ref=ref, include_history=True)
                            self.assertEqual(len(history["history"]), 2)
                            self.assertTrue(all("projects" in r and "scope" not in r for r in history["history"]))
                            self.assertEqual((await call(cos, "list", selector="projects", projects=["MY PROJECT"], include_global=False))["total"], 1)
                            recalled = await call(other_cos, "recall", query="Which database stores project data?", selector="projects", projects=["atlas"], include_global=False)
                            self.assertEqual([r["ref"] for r in recalled["records"]], [ref])
                            inventory = await call(cos, "list", selector="all")
                            self.assertEqual(inventory["total"], 3)
                            personal = await call(cos, "update", ref=personal["ref"], content="The owner prefers concise replies with enough context to decide.", reason="Owner clarified the preference")
                            consolidated = await call(cos, "consolidate_global", run_id=run_id)
                            generation = consolidated["generation_id"]
                            self.assertEqual(consolidated["input_count"], 1)
                            hints = await call(cos, "global_relationships")
                            self.assertEqual(hints["status"], "current")
                            self.assertEqual(hints["edges"], [])  # A single global survivor has no pair.
                            self.assertEqual((await call(cos, "list", selector="all"))["total"], 3)
                            too_long = await cos.call_tool("memory_remember", {"content": "word " * 300, "projects": ["global"]})
                            self.assertTrue(too_long.isError)
                finally:
                    server.should_exit = True
                    await asyncio.wait_for(task, 10)
                    sock.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
