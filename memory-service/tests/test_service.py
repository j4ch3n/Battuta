import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from battuta_memory.config import MemoryConfig
from sqlite_vec import serialize_float32
from battuta_memory.contracts import GetRequest, ListRequest, RecallRequest, InventoryRequest, SetCuesRequest, CueTargetsRequest
from battuta_memory.service import MemoryService
from battuta_memory.state import StateStore
from battuta_memory.upstream import UpstreamAdapter


def vec(x):
    return serialize_float32([float(x), 0.0, 0.0])


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
        async def execute(fn): return fn()
        self.backend = UpstreamAdapter(SimpleNamespace(conn=self.conn, _execute_with_retry=execute))
        self.embeddings = {}
        self.backend.embed = lambda text: self.embeddings.get(text, vec(0))
        self.backend.embedding_fits = lambda text: True
        self.backend.truncate_for_embedding = lambda text: text
        self.state = StateStore.open(self.root / "state.db")
        self.addCleanup(self.state.close)
        self.service = MemoryService(self.backend, MemoryConfig(data_dir=self.root), self.state)
        self.add("a", "Atlas note", "proj:atlas,work", 1.5)
        self.add("b", "Global note", "proj:global,work", 1)
        self.add("c", "Beacon secret", "proj:beacon,work", 0)
        self.add("d", "Old atlas", "proj:atlas", 0.5, superseded="a" * 64)

    def add(self, char, content, tags, distance, superseded=None):
        cursor = self.conn.execute("INSERT INTO memories(content_hash,content,tags,memory_type,metadata,created_at,updated_at,superseded_by,version,embedding_pending) VALUES(?,?,?,?,?,?,?,?,1,0)",
            (char * 64, content, tags, "observation", json.dumps({"sources": [{"agent_id": "cos", "session_id": "s", "entry_id": char}]}), 1, 1, superseded))
        self.conn.execute("INSERT INTO memory_embeddings VALUES(?,?)", (cursor.lastrowid, vec(distance)))

    async def test_scoped_recall_filters_before_limit(self):
        for n in range(30):
            self.add(str(n), "Distractor", "proj:beacon", 0)
        result = await self.service.recall(RecallRequest(semantic_query="note", selector="projects", projects=["Atlas"], limit=2, max_distance=2))
        self.assertEqual([r["content"] for r in result["records"]], ["Global note", "Atlas note"])
        self.assertEqual(result["status"], "success")

    async def test_scope_and_tag_and_kind_not_scope_or_tag(self):
        result = await self.service.list(ListRequest(selector="projects", projects=["atlas"], tags=["work"], kind="observation"))
        self.assertEqual([r["ref"] for r in result["records"]], ["a" * 64, "b" * 64])
        self.assertEqual(result["total"], 2)

    async def test_history_and_inventory_agree(self):
        with self.assertRaisesRegex(ValueError, "inactive"):
            await self.service.get(GetRequest(ref="d" * 64))
        result = await self.service.list(ListRequest(selector="projects", projects=["atlas"], include_history=True))
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
            await self.service.list(ListRequest(selector="all"))

    async def test_explicit_global_only_returns_global_records(self):
        result = await self.service.recall(RecallRequest(semantic_query="note", selector="global", limit=10, max_distance=2))
        self.assertFalse(result["warnings"])
        self.assertEqual([r["content"] for r in result["records"]], ["Global note"])

    async def test_default_recall_searches_all_scopes(self):
        result = await self.service.recall(RecallRequest(semantic_query="note", limit=10, max_distance=2))
        self.assertFalse(result["warnings"])
        self.assertEqual([r["content"] for r in result["records"]], ["Beacon secret", "Global note", "Atlas note"])

    async def test_inventory_returns_only_active_records_in_creation_order(self):
        self.conn.execute("UPDATE memories SET created_at=5 WHERE content_hash=?", ("a" * 64,))
        self.conn.execute("UPDATE memories SET deleted_at=11 WHERE content_hash=?", ("c" * 64,))
        result = await self.service.inventory(InventoryRequest())
        self.assertEqual(list(result), ["records"])
        self.assertEqual([r["ref"] for r in result["records"]], ["b" * 64, "a" * 64])

    async def test_inventory_fails_closed_on_size_and_pending_embeddings(self):
        with self.assertRaisesRegex(ValueError, "limit"):
            await self.service.inventory(InventoryRequest(max_records=1))
        self.conn.execute("UPDATE memories SET embedding_pending=1 WHERE content_hash=?", ("a" * 64,))
        with self.assertRaisesRegex(ValueError, "pending embeddings"):
            await self.service.inventory(InventoryRequest())

    async def test_cluster_groups_per_project_and_global_members_join_each_project(self):
        import numpy as np
        from battuta_memory.contracts import ClusterRequest
        self.conn.execute("DELETE FROM memories")
        self.conn.execute("DELETE FROM memory_embeddings")
        for char, tags, vector in [("a", "proj:atlas,proj:global", [1, 0]), ("b", "proj:atlas", [1, 0.1]), ("c", "proj:atlas", [0, 1]),
                ("d", "proj:beacon", [1, 0]), ("e", "proj:global", [1, 0.05])]:
            self.add(char, char, tags, 0)
            self.conn.execute("UPDATE memory_embeddings SET content_embedding=? WHERE rowid=(SELECT id FROM memories WHERE content_hash=?)",
                (np.array(vector + [0] * 382, dtype="<f4").tobytes(), char * 64))
        self.conn.execute("UPDATE memories SET created_at=id")
        result = await self.service.cluster(ClusterRequest())
        by_project = {p["project"]: p for p in result["projects"]}
        self.assertEqual(list(by_project), ["atlas", "beacon", "global"])
        self.assertEqual(by_project["atlas"]["clusters"], [["a" * 64, "b" * 64]])
        self.assertEqual(by_project["atlas"]["singletons"], 1)
        self.assertEqual(by_project["global"]["clusters"], [["a" * 64, "e" * 64]])
        self.assertEqual(by_project["beacon"], {"project": "beacon", "clusters": [], "singletons": 1, "largest": 0, "raised": []})

    async def test_cluster_fails_closed_on_pending_embeddings(self):
        from battuta_memory.contracts import ClusterRequest
        self.conn.execute("UPDATE memories SET embedding_pending=1 WHERE content_hash=?", ("a" * 64,))
        with self.assertRaisesRegex(ValueError, "pending embeddings"):
            await self.service.cluster(ClusterRequest())

    async def test_record_revision_changes_with_scope_and_state_not_distance(self):
        record = await self.service.get(GetRequest(ref="a" * 64))
        self.assertEqual(len(record["revision"]), 64)
        self.conn.execute("UPDATE memories SET tags='proj:atlas,proj:beacon' WHERE content_hash=?", ("a" * 64,))
        changed = await self.service.get(GetRequest(ref="a" * 64))
        self.assertNotEqual(record["revision"], changed["revision"])

    def vector_rows(self, ref=None):
        sql = "SELECT ref,kind,angle FROM memory_vectors" + (" WHERE ref=?" if ref else "") + " ORDER BY ref,kind,angle"
        return self.state.conn.execute(sql, (ref,) if ref else ()).fetchall()

    async def test_reconcile_runs_before_semantic_search(self):
        self.assertEqual(self.vector_rows(), [])
        result = await self.service.recall(RecallRequest(semantic_query="note", limit=10, max_distance=2))
        self.assertEqual(len(result["records"]), 3)
        self.assertEqual({row[0] for row in self.vector_rows()}, {"a" * 64, "b" * 64, "c" * 64})

    async def test_recall_matches_through_a_cue_and_returns_the_memory(self):
        a = "a" * 64
        await self.service.recall(RecallRequest(semantic_query="note", limit=10, max_distance=2))
        self.embeddings["I am visiting the atlas office"] = vec(5)
        self.embeddings["probe"] = vec(5)
        request = RecallRequest(semantic_query="probe", limit=10, max_distance=0.5)
        self.assertEqual((await self.service.recall(request))["records"], [])
        await self.service.set_cues(SetCuesRequest(ref=a, cues=[{"angle": "situation", "text": "I am visiting the atlas office"}]))
        result = await self.service.recall(request)
        self.assertEqual([r["ref"] for r in result["records"]], [a])
        self.assertNotIn("atlas office", json.dumps(result))

    async def test_expired_and_retired_memories_are_not_returned(self):
        b = "b" * 64
        meta = {"sources": [{"agent_id": "cos", "session_id": "s", "entry_id": "b"}],
            "memory_metadata": {"knowledge_type": "fact", "confidence": "confirmed", "expires_at": "2020-01-01T00:00:00Z"}}
        self.conn.execute("UPDATE memories SET metadata=? WHERE content_hash=?", (json.dumps(meta), b))
        request = dict(semantic_query="note", limit=10, max_distance=2)
        live = lambda result: {r["ref"] for r in result["records"]}
        self.assertNotIn(b, live(await self.service.recall(RecallRequest(**request))))
        self.assertIn(b, live(await self.service.recall(RecallRequest(**request, include_expired=True))))
        self.conn.execute("UPDATE memories SET deleted_at=2 WHERE content_hash=?", (b,))
        await self.service.recover()
        self.assertEqual(self.vector_rows(b), [])
        self.assertNotIn(b, live(await self.service.recall(RecallRequest(**request, include_expired=True))))

    async def test_set_cues_replaces_and_marks_processed(self):
        a, b = "a" * 64, "b" * 64
        targets = await self.service.cue_targets(CueTargetsRequest())
        self.assertEqual({r["ref"] for r in targets["records"]}, {a, b, "c" * 64})
        record = next(r for r in targets["records"] if r["ref"] == a)
        cues = [{"angle": "task", "text": "one"}, {"angle": "update", "text": "two"}]
        self.assertEqual(await self.service.set_cues(SetCuesRequest(ref=a, expected_revision=record["revision"], cues=cues)), {"ref": a, "cues": 2})
        self.assertEqual([r[1:] for r in self.vector_rows(a)], [("cue", "task"), ("cue", "update"), ("primary", "primary")])
        await self.service.set_cues(SetCuesRequest(ref=b, cues=[]))
        remaining = await self.service.cue_targets(CueTargetsRequest())
        self.assertEqual([r["ref"] for r in remaining["records"]], ["c" * 64])
        await self.service.set_cues(SetCuesRequest(ref=a, cues=[cues[0]]))
        self.assertEqual(len([r for r in self.vector_rows(a) if r[1] == "cue"]), 1)
        with self.assertRaisesRegex(ValueError, "changed since inventory"):
            await self.service.set_cues(SetCuesRequest(ref=a, expected_revision="f" * 64, cues=[]))
        with self.assertRaisesRegex(ValueError, "inactive"):
            await self.service.set_cues(SetCuesRequest(ref="d" * 64, cues=[]))
        before = self.vector_rows(a)
        def too_long(text):
            raise ValueError("Memory exceeds embedding token limit; split or rephrase")
        self.backend.embed = too_long
        with self.assertRaisesRegex(ValueError, "embedding token limit"):
            await self.service.set_cues(SetCuesRequest(ref=a, cues=cues))
        self.assertEqual(self.vector_rows(a), before)
