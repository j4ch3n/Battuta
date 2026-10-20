import unittest
from battuta_memory.contracts import CaptureBatch, UpdateRequest, RecallRequest


class ContractTests(unittest.TestCase):
    def test_blank_replacement_cannot_create_empty_memory(self):
        with self.assertRaises(ValueError):
            UpdateRequest(ref="a" * 64, content="   ", reason="correction")

    def test_recall_limits_are_validated_not_truncated(self):
        for limit in (0, 101):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                RecallRequest(query="hello", limit=limit)

    def test_capture_rejects_foreign_session_citation(self):
        with self.assertRaises(ValueError):
            CaptureBatch(session_id="current", batch_id="b", agent_id="tl", payload_digest="a" * 64,
                items=[{"item_id": "i", "content": "note", "scope": {"global": True}, "sources": [{"agent_id": "tl", "session_id": "other", "entry_id": "e"}]}])
