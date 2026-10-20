"""Characterize the pinned storage with real SQLite; replace only model inference."""
import tempfile
import unittest
import math
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
                # The derived graph is global-only, uses surviving hashes, and
                # must never write back through upstream consolidation storage.
                self.assertEqual((await adapter.global_snapshot())["records"], [])
                globals_ = []
                for i in range(7):
                    text = f"The owner values clear writing and thoughtful decisions {i}."
                    content_hash = generate_content_hash(text)
                    await storage.store(Memory(text, content_hash, tags=["scope:global", "writing"]), skip_semantic_dedup=True)
                    globals_.append(content_hash)
                ok, _, replacement = await storage.update_memory_versioned(globals_[0], "The owner values clear writing and thoughtful decisions today.")
                self.assertTrue(ok)
                await storage.delete(globals_[1])
                # Moderate cosine similarity exercises actual association discovery.
                rowid = storage.conn.execute("SELECT id FROM memories WHERE content_hash=?", (replacement,)).fetchone()[0]
                storage.conn.execute("UPDATE memory_embeddings SET content_embedding=? WHERE rowid=?",
                    (serialize_float32([0.2, math.sqrt(0.96)] + [0.0] * 382), rowid))
                storage.conn.commit()
                snapshot = await adapter.global_snapshot()
                self.assertEqual({r["ref"] for r in snapshot["records"]}, {*globals_[2:], replacement})
                before = storage.conn.execute("SELECT * FROM memories ORDER BY id").fetchall()
                graph_before = storage.conn.execute("SELECT * FROM memory_graph").fetchall()
                derived = await adapter.analyze_global(snapshot)
                self.assertEqual(derived["clusters"], [{"member_refs": sorted(globals_[2:])}])
                self.assertTrue(derived["edges"])
                self.assertTrue(all(e["source_ref"] in {*globals_[2:], replacement} and e["target_ref"] in {*globals_[2:], replacement} for e in derived["edges"]))
                self.assertEqual(storage.conn.execute("SELECT * FROM memories ORDER BY id").fetchall(), before)
                self.assertEqual(storage.conn.execute("SELECT * FROM memory_graph").fetchall(), graph_before)
                await storage.update_memory_metadata(newer, {"tags": ["proj:beacon"]})
                self.assertEqual((await adapter.global_snapshot())["input_fingerprint"], snapshot["input_fingerprint"])
                await storage.update_memory_metadata(replacement, {"tags": ["proj:atlas"]})
                self.assertNotEqual((await adapter.global_snapshot())["input_fingerprint"], snapshot["input_fingerprint"])
                for mode in ("overflow", "pending", "missing", "nonfinite"):
                    with self.subTest(mode=mode):
                        if mode == "pending":
                            storage.conn.execute("UPDATE memories SET embedding_pending=1 WHERE content_hash=?", (globals_[2],))
                        if mode == "missing":
                            storage.conn.execute("DELETE FROM memory_embeddings WHERE rowid=(SELECT id FROM memories WHERE content_hash=?)", (globals_[2],))
                        if mode == "nonfinite":
                            # Validate corrupted vectors at the SQL boundary without
                            # depending on sqlite-vec accepting a NaN write.
                            rows = await adapter._rows("SELECT m.*, ? AS content_embedding FROM memories m WHERE content_hash=?", (serialize_float32([float("nan")] + [0.] * 383), globals_[2]))
                            with patch.object(adapter, "_rows", return_value=rows), self.assertRaises(ValueError):
                                await adapter.global_snapshot()
                            continue
                        storage.conn.commit()
                        with self.assertRaises(ValueError):
                            await adapter.global_snapshot(max_records=1 if mode == "overflow" else 500)
                        storage.conn.execute("UPDATE memories SET embedding_pending=0")
                        storage.conn.commit()
            finally:
                await storage.close()
