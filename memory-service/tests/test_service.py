import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from battuta_memory.config import MemoryConfig
from battuta_memory.contracts import GetRequest, ListRequest, RecallRequest, InventoryRequest
from battuta_memory.service import MemoryService
from battuta_memory.upstream import UpstreamAdapter


class ServiceReads(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE memories(id INTEGER PRIMARY KEY, content_hash TEXT, content TEXT, tags TEXT, memory_type TEXT,
                metadata TEXT, created_at REAL, updated_at REAL, parent_id TEXT, superseded_by TEXT, deleted_at REAL, version INTEGER, embedding_pending INTEGER);
            CREATE TABLE memory_embeddings(rowid INTEGER PRIMARY KEY, content_embedding BLOB);
        """)
        self.conn.create_function("vec_distance_l2", 2, lambda a, b: abs(float(a) - float(b)))
        async def execute(fn): return fn()
        self.backend = UpstreamAdapter(SimpleNamespace(conn=self.conn, _execute_with_retry=execute))
        self.backend.embed = lambda text: b"0"
        self.service = MemoryService(self.backend, MemoryConfig(data_dir=self.root, registry_root=self.root))
        for name in ("atlas", "beacon"):
            folder = self.root / name
            (folder / "code").mkdir(parents=True)
            (folder / "project.yaml").write_text(f"version: 1\nproject:\n  name: {name}\n  path: {folder}/code\n")
        (self.root / ".config.json").write_text('{"currentProject":"atlas"}')
        self.add("a", "Atlas note", "proj:atlas,work", 3)
        self.add("b", "Global note", "scope:global,work", 2)
        self.add("c", "Beacon secret", "proj:beacon,work", 0)
        self.add("d", "Old atlas", "proj:atlas", 1, superseded="a" * 64)

    def add(self, char, content, tags, distance, superseded=None):
        cursor = self.conn.execute("INSERT INTO memories(content_hash,content,tags,memory_type,metadata,created_at,updated_at,superseded_by,version,embedding_pending) VALUES(?,?,?,?,?,?,?,?,1,0)",
            (char * 64, content, tags, "observation", json.dumps({"sources": []}), 1, 1, superseded))
        self.conn.execute("INSERT INTO memory_embeddings VALUES(?,?)", (cursor.lastrowid, str(distance).encode()))

    async def test_scoped_recall_filters_before_limit(self):
        for n in range(30):
            self.add(str(n), "Distractor", "proj:beacon", 0)
        result = await self.service.recall(RecallRequest(query="note", limit=2))
        self.assertEqual([r["content"] for r in result["records"]], ["Global note", "Atlas note"])
        self.assertFalse(result["incomplete"])

    async def test_scope_and_tag_and_kind_not_scope_or_tag(self):
        result = await self.service.list(ListRequest(tags=["work"], kind="observation"))
        self.assertEqual([r["ref"] for r in result["records"]], ["a" * 64, "b" * 64])
        self.assertEqual(result["total"], 2)

    async def test_history_and_inventory_agree(self):
        with self.assertRaisesRegex(ValueError, "inactive"):
            await self.service.get(GetRequest(ref="d" * 64))
        result = await self.service.list(ListRequest(include_history=True))
        self.assertEqual(result["total"], 3)
        record = await self.service.get(GetRequest(ref="d" * 64, include_history=True))
        self.assertFalse(record["active"])

    async def test_stable_pages_and_all_selector(self):
        result = await self.service.list(ListRequest(selector="all", page=2, page_size=1))
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["records"][0]["ref"], "b" * 64)

    async def test_missing_ref_and_backend_failure_not_empty_success(self):
        with self.assertRaisesRegex(ValueError, "not found"):
            await self.service.get(GetRequest(ref="f" * 64))
        self.conn.execute("DROP TABLE memories")
        with self.assertRaises(sqlite3.Error):
            await self.service.list(ListRequest())

    async def test_missing_selection_is_global_only(self):
        (self.root / ".config.json").unlink()
        result = await self.service.recall(RecallRequest(query="note"))
        self.assertTrue(result["warnings"])
        self.assertEqual([r["content"] for r in result["records"]], ["Global note"])

    async def test_inventory_keeps_older_context_and_recent_invalidations(self):
        self.conn.execute("UPDATE memories SET updated_at=10 WHERE content_hash=?", ("a" * 64,))
        self.conn.execute("UPDATE memories SET deleted_at=11 WHERE content_hash=?", ("c" * 64,))
        result = await self.service.inventory(InventoryRequest(window_start=10, window_end=12))
        self.assertEqual([r["ref"] for r in result["records"]], ["a" * 64, "b" * 64])
        self.assertEqual(result["recent_refs"], ["a" * 64, "c" * 64])
        self.assertEqual({r["ref"] for r in result["inactive"]}, {"c" * 64, "d" * 64})
        self.assertNotIn("content", result["inactive"][0])

    async def test_inventory_window_is_half_open_and_bounded_without_truncation(self):
        self.conn.execute("UPDATE memories SET updated_at=12 WHERE content_hash=?", ("a" * 64,))
        result = await self.service.inventory(InventoryRequest(window_start=10, window_end=12))
        self.assertEqual(result["recent_refs"], [])
        with self.assertRaisesRegex(ValueError, "limit"):
            await self.service.inventory(InventoryRequest(window_start=0, window_end=12, max_records=2))

    def test_inventory_rejects_invalid_time_windows(self):
        for start, end in [(12, 12), (13, 12), (-1, 12), (0, float("inf")), (float("nan"), 12)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                InventoryRequest(window_start=start, window_end=end)

    async def test_record_revision_changes_with_scope_and_state_not_distance(self):
        record = await self.service.get(GetRequest(ref="a" * 64))
        self.assertEqual(len(record["revision"]), 64)
        self.conn.execute("UPDATE memories SET tags='proj:atlas,proj:beacon' WHERE content_hash=?", ("a" * 64,))
        changed = await self.service.get(GetRequest(ref="a" * 64))
        self.assertNotEqual(record["revision"], changed["revision"])
