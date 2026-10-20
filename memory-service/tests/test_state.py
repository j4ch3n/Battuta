import tempfile
import unittest
from pathlib import Path
from battuta_memory.state import StateStore


class StateTests(unittest.TestCase):
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
