from unittest.mock import patch

from battuta_memory.contracts import RecallRequest, RememberRequest, SetMetadataRequest
from battuta_memory.retrieval import fuse_ranks
from test_mutations import StorageFixture
from test_records import SOURCE, fact


class RetrievalTests(StorageFixture):
    async def note_with_metadata(self, content, project=None, **metadata):
        return await self.service.remember(RememberRequest(content=content, projects=[project] if project else ["global"],
            sources=[SOURCE], memory_metadata=fact(**metadata)["memory_metadata"]))

    async def test_alias_lexical_retrieval_and_metadata_only_index_refresh(self):
        target = await self.note_with_metadata("Owner reported buying an NS2", keywords=["NS2", "Nintendo", "gaming"])
        await self.note_with_metadata("Unrelated current choice", keywords=["shopping"])
        with patch.object(self.adapter, "search", return_value=[]):
            result = await self.service.recall(RecallRequest(query="Nintendo", selector="global"))
            self.assertEqual([r["ref"] for r in result["records"]], [target["ref"]])
            record = await self.adapter.get(target["ref"])
            with patch.object(self.adapter, "embed", side_effect=AssertionError("metadata must not embed")):
                await self.service.set_metadata(SetMetadataRequest(ref=target["ref"], expected_revision=record["revision"], idempotency_key="alias", memory_metadata={**record["memory_metadata"], "keywords": ["console"]}))
            self.assertEqual((await self.service.recall(RecallRequest(query="Nintendo", selector="global")))["records"], [])
            self.assertEqual((await self.service.recall(RecallRequest(query="console", selector="global")))["records"][0]["ref"], target["ref"])

    async def test_filters_apply_before_both_candidate_limits_and_query_operators_are_literal(self):
        from sqlite_vec import serialize_float32
        self.adapter.embed = lambda _: serialize_float32([1.0] + [0.0] * 383)
        for i in range(22):
            await self.note_with_metadata(f"Nintendo past event {i}", expires_at="2020-01-01T00:00:00Z")
        await self.note_with_metadata("Nintendo rejected claim", status="rejected")
        await self.note_with_metadata("Nintendo wrong scope", project="beacon")
        target = await self.note_with_metadata("Owner reported buying an NS2", project="atlas", keywords=["Nintendo"])
        result = await self.service.recall(RecallRequest(query="Nintendo", selector="projects", projects=["atlas"], limit=1))
        self.assertEqual([r["ref"] for r in result["records"]], [target["ref"]])
        with patch.object(self.adapter, "search", return_value=[]):
            result = await self.service.recall(RecallRequest(query='" OR NOT * :', selector="global"))
            self.assertEqual(result["records"], [])
            self.assertEqual(result["branches"]["lexical"], "ready")

    async def test_index_failure_retains_intent_then_recovery_rebuilds_before_ack(self):
        with patch.object(self.state, "reconcile_index", side_effect=RuntimeError("index offline")):
            with self.assertRaises(RuntimeError):
                await self.note_with_metadata("Owner reported buying an NS2", keywords=["Nintendo"])
        self.assertEqual(len(self.state.recover_intents()), 1)
        await self.service.recover()
        self.assertEqual(self.state.recover_intents(), [])
        with patch.object(self.adapter, "search", side_effect=RuntimeError("semantic offline")):
            result = await self.service.recall(RecallRequest(query="Nintendo", selector="global"))
        self.assertEqual(len(result["records"]), 1)
        self.assertTrue(result["incomplete"])
        self.assertEqual(result["branches"]["semantic"], "unavailable")

    def test_rank_fusion_deduplicates_and_breaks_ties_by_ref(self):
        self.assertEqual(fuse_ranks(["b", "a"], ["a", "b"], 2), ["a", "b"])
