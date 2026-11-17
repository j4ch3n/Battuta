import unittest
from battuta_memory.contracts import CaptureBatch, UpdateRequest, RecallRequest


class ContractTests(unittest.TestCase):
    def test_recall_queries_are_stripped_and_single_query_joins_the_list(self):
        request = RecallRequest(semantic_query=" first ", semantic_queries=[" second "], limit=10, max_distance=0.9)
        self.assertEqual(request.semantic_queries, ["first", "second"])
        for queries in (["  "], ["ok", ""]):
            with self.subTest(queries=queries), self.assertRaises(ValueError):
                RecallRequest(semantic_queries=queries)

    def test_source_provenance_accepts_current_role_identities(self):
        from battuta_memory.contracts import SourceRef
        for role in ("cos", "manager"):
            with self.subTest(role=role):
                source = SourceRef(agent_id=role, session_id="session", entry_id="entry")
                self.assertEqual(source.agent_id, role)

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
            for model, args in ((RememberRequest, {"content": "fact", "projects": ["global"]}),
                                (ListRequest, {"selector": "all"}),
                                (UpdateRequest, {"ref": "a" * 64, "content": "fact", "reason": "correction"})):
                with self.subTest(tag=tag, model=model.__name__), self.assertRaises(ValueError):
                    model(**args, tags=[tag])

    def test_blank_replacement_cannot_create_empty_memory(self):
        with self.assertRaises(ValueError):
            UpdateRequest(ref="a" * 64, content="   ", reason="correction")

    def test_recall_limits_are_validated_not_truncated(self):
        for limit in (0, 101):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                RecallRequest(semantic_query="hello", limit=limit, max_distance=0.9)

    def test_recall_requires_limit_and_max_distance(self):
        for overrides in ({"limit": None}, {"max_distance": None}, {"max_distance": 0}, {"max_distance": 2.5}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                RecallRequest(**{"semantic_query": "hello", "limit": 10, "max_distance": 0.9, **overrides})
        self.assertEqual(RecallRequest(semantic_query="hello", limit=10, max_distance=0.9).max_distance, 0.9)

    def test_capture_rejects_foreign_session_citation(self):
        with self.assertRaises(ValueError):
            CaptureBatch(session_id="current", batch_id="b", agent_id="manager", payload_digest="a" * 64,
                items=[{"item_id": "i", "content": "note", "projects": ["global"], "sources": [{"agent_id": "manager", "session_id": "other", "entry_id": "e"}]}])
