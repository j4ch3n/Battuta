import unittest
from unittest.mock import patch
from test_mutations import StorageFixture
from battuta_memory.capture import CaptureService
from battuta_memory.contracts import CaptureBatch, ForgetRequest
from battuta_memory.service import MemoryService


class CaptureTests(StorageFixture):
    def batch(self, items=None):
        items = items if items is not None else [{"item_id": "fact-1", "content": "Useful fact", "scope": {"global": True},
            "sources": [{"agent_id": "pm", "session_id": "s", "entry_id": "entry-1"}]}]
        payload = {"session_id": "s", "batch_id": "batch", "agent_id": "pm", "items": items}
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
