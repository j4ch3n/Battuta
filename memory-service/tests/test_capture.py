import unittest
import hashlib
import json
from unittest.mock import patch
from test_mutations import StorageFixture
from battuta_memory.capture import CaptureService
from battuta_memory.contracts import CaptureBatch, ForgetRequest
from battuta_memory.service import MemoryService


class CaptureTests(StorageFixture):
    async def test_new_wire_replays_a_historical_capture_receipt_without_embedding(self):
        legacy = {"session_id": "s", "batch_id": "batch", "agent_id": "cos", "items": [{
            "item_id": "fact-1", "content": "Useful fact", "scope": {"global": True, "projects": []},
            "tags": [], "kind": "observation", "idempotency_key": None,
            "sources": [{"agent_id": "cos", "session_id": "s", "entry_id": "entry-1"}],
        }]}
        historical_digest = hashlib.sha256(json.dumps(legacy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        batch = self.batch()
        self.assertEqual(batch.payload_digest, historical_digest)
        key = self.service.digest(["cos", "s", "batch"])
        self.state.capture_receipt(key, historical_digest)
        receipt = {"batch_id": "batch", "complete": True, "items": [{"item_id": "fact-1", "status": "completed", "ref": "a" * 64}]}
        self.state.complete_capture(key, receipt)
        with patch.object(self.adapter, "embed", side_effect=AssertionError("must not embed on replay")):
            self.assertEqual(await CaptureService(self.service).ingest(batch), receipt)

    async def test_owner_correction_versions_old_fact_and_invalidates_dependents_on_upload(self):
        from battuta_memory.contracts import RememberRequest
        from battuta_memory.records import eligible_records
        from test_records import fact, SOURCE, NOW
        old = await self.service.remember(RememberRequest(content="Owner owns an NS2", projects=["global"], sources=[SOURCE], memory_metadata=fact()["memory_metadata"]))
        source = await self.adapter.get(old["ref"])
        link = {"ref": old["ref"], "revision": source["revision"], "relation": "supports", "requirement": "current"}
        derived = await self.service.remember(RememberRequest(content="Owner may want console games", projects=["global"], sources=[SOURCE], memory_metadata=fact(knowledge_type="hypothesis", confidence="tentative", rationale="Possible interest", evidence=[link])["memory_metadata"]))
        item = {"item_id": "correction", "content": "Owner returned the NS2", "projects": ["global"], "sources": [SOURCE], "memory_metadata": fact()["memory_metadata"], "correction": {"ref": old["ref"], "revision": source["revision"]}}
        batch = self.batch([item])
        capture = CaptureService(self.service)
        result = await capture.ingest(batch)
        self.assertTrue(result["complete"])
        self.assertEqual(await capture.ingest(batch), result)
        self.assertFalse((await self.adapter.get(old["ref"]))["active"])
        replacement = await self.adapter.get(result["items"][0]["ref"])
        self.assertEqual(replacement["memory_metadata"]["stage"], "temporal")
        self.assertEqual(eligible_records([replacement, await self.adapter.get(derived["ref"])], NOW), [replacement])

    def batch(self, items=None):
        items = items if items is not None else [{"item_id": "fact-1", "content": "Useful fact", "projects": ["global"],
            "sources": [{"agent_id": "cos", "session_id": "s", "entry_id": "entry-1"}]}]
        payload = {"session_id": "s", "batch_id": "batch", "agent_id": "cos", "items": items}
        # Digest canonicalization covers normalized item defaults in both clients.
        provisional = CaptureBatch(**payload, payload_digest="0" * 64)
        payload["payload_digest"] = CaptureService.digest(provisional)
        return CaptureBatch(**payload)

    async def test_empty_extraction_is_receipted(self):
        result = await CaptureService(self.service).ingest(self.batch([]))
        self.assertTrue(result["complete"])
        self.assertEqual(result["items"], [])

    async def test_retry_does_not_resurrect_forgotten_capture(self):
        capture = CaptureService(self.service)
        batch = self.batch()
        result = await capture.ingest(batch)
        await self.service.forget(ForgetRequest(ref=result["items"][0]["ref"]))
        self.assertEqual(await capture.ingest(batch), result)
        self.assertIsNone(await self.adapter.get(result["items"][0]["ref"]))
        with self.assertRaisesRegex(ValueError, "conflict"):
            await capture.ingest(self.batch([]))

    async def test_mismatched_digest_rejected(self):
        batch = self.batch().model_copy(update={"payload_digest": "f" * 64})
        with self.assertRaisesRegex(ValueError, "digest"):
            await CaptureService(self.service).ingest(batch)

    async def test_partial_batch_resumes_without_rewriting_success(self):
        batch = self.batch()
        item = batch.items[0].model_dump(by_alias=True)
        second = {**item, "item_id": "fact-2", "content": "Another fact"}
        batch = self.batch([item, second])
        capture = CaptureService(self.service)
        store = self.adapter.store
        async def fail_second(payload):
            if payload["content"] == "Another fact":
                raise RuntimeError("service unavailable")
            await store(payload)
        with patch.object(self.adapter, "store", side_effect=fail_second):
            first = await capture.ingest(batch)
        self.assertFalse(first["complete"])
        second = await capture.ingest(batch)
        self.assertTrue(second["complete"])
        self.assertEqual(self.adapter.storage.conn.execute("SELECT count(*) FROM memories").fetchone()[0], 2)
