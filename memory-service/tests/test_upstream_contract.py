"""Characterize the pinned storage with real SQLite; replace only model inference."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from battuta_memory.config import MemoryConfig
from battuta_memory.contracts import RecallRequest
from battuta_memory.scope import ResolvedSelector
from battuta_memory.upstream import UpstreamAdapter


class UpstreamContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_schema_scope_and_version_lineage(self):
        config = MemoryConfig()
        config.configure_upstream()
        from mcp_memory_service.storage.sqlite_vec import SqliteVecMemoryStorage
        from mcp_memory_service.models.memory import Memory
        from mcp_memory_service.utils.hashing import generate_content_hash
        async def fake_model(storage):
            storage.embedding_dimension = 384
            storage.embedding_model = object()
        with tempfile.TemporaryDirectory() as folder, patch.object(SqliteVecMemoryStorage, "_initialize_embedding_model", fake_model), patch.object(SqliteVecMemoryStorage, "_generate_embedding", return_value=[1.0] + [0.0] * 383):
            storage = SqliteVecMemoryStorage(str(Path(folder) / "memory.db"))
            await storage.initialize()
            try:
                ref = generate_content_hash("old fact")
                ok, message = await storage.store(Memory("old fact", ref, tags=["proj:atlas"]), skip_semantic_dedup=True)
                self.assertTrue(ok, message)
                ok, message, newer = await storage.update_memory_versioned(ref, "new fact")
                self.assertTrue(ok, message)
                adapter = UpstreamAdapter(storage)
                from sqlite_vec import serialize_float32
                adapter.embed = lambda _: serialize_float32([1.0] + [0.0] * 383)
                result = await adapter.search(RecallRequest(query="fact"), ResolvedSelector(["proj:atlas"]))
                self.assertEqual([r["ref"] for r in result], [newer])
                self.assertEqual([r["ref"] for r in await adapter.history(newer)], [ref, newer])
                self.assertEqual(await adapter.search(RecallRequest(query="fact"), ResolvedSelector(["proj:beacon"])), [])
            finally:
                await storage.close()
