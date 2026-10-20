import tempfile
import unittest
import sqlite3
from pathlib import Path
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
