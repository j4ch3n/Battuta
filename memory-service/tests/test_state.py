import tempfile
import unittest
import sqlite3
from pathlib import Path
from sqlite_vec import serialize_float32
from battuta_memory.state import StateStore


class StateTests(unittest.TestCase):
    def test_graph_draft_survives_restart_and_activation_is_atomic(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.db"
            state = StateStore.open(path)
            state.prepare_intent("old", "digest", {})
            state.complete_intent("old", {"ref": "kept"})
            draft = {"generation_id": "a", "input_fingerprint": "i", "algorithm_fingerprint": "v", "edges": [], "clusters": []}
            state.save_graph_draft(draft)
            self.assertIsNone(state.graph_active())
            state.close()
            state = StateStore.open(path)
            self.addCleanup(state.close)
            self.assertEqual(state.receipt("old", "digest"), {"ref": "kept"})
            self.assertEqual(state.graph_draft("i", "v"), draft)
            self.assertIsNone(state.graph_draft("other", "v"))
            self.assertEqual(state.activate_graph("a"), draft)
            self.assertEqual(state.activate_graph("a"), draft)
            newer = {**draft, "generation_id": "b", "input_fingerprint": "j"}
            state.save_graph_draft(newer)
            # Reject the draft removal after active was replaced: both changes
            # must roll back, never expose a half-published generation.
            state.conn.execute("CREATE TEMP TRIGGER fail_graph BEFORE DELETE ON global_graph WHEN OLD.slot='draft' BEGIN SELECT RAISE(ABORT, 'interrupted'); END")
            with self.assertRaises(sqlite3.IntegrityError):
                state.activate_graph("b")
            self.assertEqual(state.graph_active(), draft)
            state.conn.execute("DROP TRIGGER fail_graph")
            self.assertEqual(state.activate_graph("b"), newer)
            self.assertIsNone(state.graph_draft("j", "v"))
            state.save_graph_draft(draft)
            self.assertEqual(state.conn.execute("SELECT count(*) FROM global_graph").fetchone()[0], 2)
            state.discard_graph_draft()
            self.assertEqual(state.graph_active(), newer)

    def test_model_fingerprint_cannot_change_at_same_dimension(self):
        with tempfile.TemporaryDirectory() as folder:
            state = StateStore.open(Path(folder) / "state.db")
            self.addCleanup(state.close)
            state.bind_model({"fingerprint": "model-a", "dimension": 384})
            state.bind_model({"fingerprint": "model-a", "dimension": 384})
            with self.assertRaisesRegex(RuntimeError, "migration"):
                state.bind_model({"fingerprint": "model-b", "dimension": 384})

    def test_receipt_replay_and_payload_erasure(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.db"
            state = StateStore.open(path)
            state.prepare_intent("i", "digest", {"content": "private"})
            state.close()
            state = StateStore.open(path)
            self.addCleanup(state.close)
            self.assertEqual(state.recover_intents()[0]["payload"], {"content": "private"})
            state.complete_intent("i", {"ref": "r"})
            self.assertEqual(state.prepare_intent("i", "digest", {"content": "private"})["result"], {"ref": "r"})
            self.assertEqual(state.recover_intents(), [])
            self.assertIsNone(state.conn.execute("SELECT payload FROM intents").fetchone()[0])
            with self.assertRaisesRegex(ValueError, "conflict"):
                state.prepare_intent("i", "different", {})


def vec(x):
    return serialize_float32([x, 0.0, 0.0])


def rec(ref, inference=False, active=True):
    metadata = {"knowledge_type": "inference"} if inference else {}
    return {"ref": ref, "active": active, "memory_metadata": metadata}


class VectorTests(unittest.TestCase):
    def open(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        state = StateStore.open(Path(folder.name) / "state.db")
        self.addCleanup(state.close)
        return state

    def rows(self, state):
        return state.conn.execute("SELECT ref,kind,angle FROM memory_vectors ORDER BY ref,kind,angle").fetchall()

    def test_reconcile_adds_own_vectors_and_removes_retired(self):
        state = self.open()
        state.conn.execute("INSERT INTO memory_vectors(ref,kind,angle,embedding) VALUES('gone','cue','task',?)", (vec(1),))
        records = [rec("a"), rec("b", inference=True)]
        state.reconcile_vectors(records, {"a": vec(1), "b": vec(2)})
        expected = [("a", "primary", "primary"), ("b", "hypothesis", "hypothesis")]
        self.assertEqual(self.rows(state), expected)
        state.reconcile_vectors(records, {"a": vec(1), "b": vec(2)})
        self.assertEqual(self.rows(state), expected)

    def test_reconcile_skips_refs_without_a_vector(self):
        state = self.open()
        records = [rec("a"), rec("b")]
        state.reconcile_vectors(records, {"a": vec(1)})
        self.assertEqual(self.rows(state), [("a", "primary", "primary")])
        self.assertEqual(state.missing_vector_refs(records), ["b"])

    def test_vector_search_collapses_cues_and_honours_limits(self):
        state = self.open()
        state.reconcile_vectors([rec("a"), rec("b"), rec("c"), rec("d")], {"a": vec(1), "b": vec(0.5), "c": vec(0), "d": vec(0.2)})
        state.replace_cues("a", [("task", vec(0.1))])
        state.replace_cues("d", [])
        got = state.vector_search(vec(0), ["a", "b", "c", "d"], 0.9, 10)
        self.assertEqual(got, ["c", "a", "d", "b"])
        self.assertEqual(state.vector_search(vec(0), ["a", "b"], 0.9, 10), ["a", "b"])
        self.assertEqual(state.vector_search(vec(0), ["a", "b", "c"], 0.3, 10), ["c", "a"])
        self.assertEqual(state.vector_search(vec(0), ["a", "b", "c"], 0.9, 1), ["c"])

    def test_cue_targets_and_replace_cues(self):
        state = self.open()
        records = [rec("a"), rec("b")]
        state.reconcile_vectors(records, {"a": vec(1), "b": vec(1)})
        self.assertEqual(state.cue_targets(records, 10), ["a", "b"])
        self.assertEqual(state.cue_targets(records, 1), ["a"])
        self.assertEqual(state.cue_targets(records + [rec("novector")], 10), ["a", "b"])
        state.replace_cues("a", [("situation", vec(2))])
        state.replace_cues("b", [])
        self.assertEqual(state.cue_targets(records, 10), [])
        self.assertIn(("b", "none", None), self.rows(state))
        state.replace_cues("a", [("own_words", vec(3))])
        self.assertEqual([r for r in self.rows(state) if r[0] == "a"], [("a", "cue", "own_words"), ("a", "primary", "primary")])
        with self.assertRaisesRegex(ValueError, "no vector"):
            state.replace_cues("missing", [])
