import unittest
from battuta_memory.contracts import CaptureBatch, UpdateRequest, RecallRequest


class ContractTests(unittest.TestCase):
    def test_consolidation_has_fixed_scope_and_requires_an_explicit_run_instant(self):
        from battuta_memory.contracts import ConsolidateGlobalRequest
        self.assertEqual(ConsolidateGlobalRequest(run_id="2026-10-21T03:00:00Z").run_id, "2026-10-21T03:00:00Z")
        for args in ({"run_id": "not-a-date"}, {"run_id": "2026-10-21T03:00:00"},
                     {"run_id": "2026-10-21T03:00:00Z", "scope": "all"},
                     {"run_id": "2026-10-21T03:00:00Z", "edges": []},
                     {"run_id": "2026-10-21T03:00:00Z", "phases": ["forgetting"]}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                ConsolidateGlobalRequest(**args)

    def test_csv_tags_cannot_inject_reserved_scope_or_kind(self):
        from battuta_memory.contracts import RememberRequest, ListRequest
        for tag in ("topic,scope:global", "topic,proj:other", "topic,kind:decision", "a,b"):
            for model, args in ((RememberRequest, {"content": "fact", "scope": {"global": True}}),
                                (ListRequest, {}),
                                (UpdateRequest, {"ref": "a" * 64, "content": "fact", "reason": "correction"})):
                with self.subTest(tag=tag, model=model.__name__), self.assertRaises(ValueError):
                    model(**args, tags=[tag])

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
