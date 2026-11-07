from copy import deepcopy
from datetime import datetime, timezone
import unittest

from battuta_memory.contracts import MemoryMetadata
from battuta_memory.records import decode_record, eligible_records, review_fingerprint


NOW = datetime(2026, 11, 6, tzinfo=timezone.utc)
SOURCE = {"agent_id": "cos", "session_id": "s", "entry_id": "e"}


def fact(ref="a", **metadata):
    return {"ref": ref * 64, "revision": ref * 64, "content": "Owner reported a purchase", "active": True,
        "scope": {"global": True, "projects": []}, "sources": [SOURCE], "kind": "event", "tags": [],
        "memory_metadata": {"stage": "temporal", "knowledge_type": "fact", "confidence": "confirmed", "status": "active",
            "keywords": ["NS2"], "mentioned_at": "2026-11-01T10:00:00Z", **metadata}}


class RecordTests(unittest.TestCase):
    def test_invalid_metadata_is_rejected(self):
        for change in ({"expires_at": "2026-11-06T10:00:00"}, {"keywords": [""]}, {"keywords": ["NS2", "ns2"]},
                {"confidence": "99%"}, {"keywords": ["bad\nterm"]}, {"keywords": ["x" * 81]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                MemoryMetadata.model_validate(fact(**change)["memory_metadata"])

    def test_utc_normalization_and_expiry_boundary(self):
        record = fact(expires_at="2026-11-06T08:00:00+08:00")
        self.assertEqual(decode_record(record)["memory_metadata"]["expires_at"], "2026-11-06T00:00:00Z")
        self.assertEqual(eligible_records([record], NOW), [])
        self.assertEqual(len(eligible_records([record], NOW, include_expired=True)), 1)

    def test_missing_attribution_and_malformed_metadata_are_preserved_but_ineligible(self):
        for change in ({"sources": []}, {"scope": {"global": False, "projects": []}}, {"memory_metadata": {"stage": "unknown"}}):
            record = {**fact(), **change}
            self.assertEqual(decode_record(record)["ref"], "a" * 64)
            self.assertEqual(eligible_records([record], NOW), [])
        legacy = fact()
        del legacy["memory_metadata"]
        self.assertIsNone(decode_record(legacy).get("memory_metadata"))

    def test_historical_support_can_expire_but_withdrawal_revision_and_cycles_suppress_dependents(self):
        support = fact(expires_at="2026-11-02T00:00:00Z")
        derived = fact("b", knowledge_type="hypothesis", confidence="tentative", rationale="Possible pattern", evidence=[{
            "ref": "a" * 64, "revision": "a" * 64, "relation": "supports", "requirement": "historical"}])
        self.assertEqual([r["ref"] for r in eligible_records([support, derived], NOW)], ["b" * 64])
        for change in ({"active": False}, {"revision": "c" * 64}):
            self.assertEqual(eligible_records([{**support, **change}, derived], NOW), [])
        derived["memory_metadata"]["evidence"][0]["requirement"] = "current"
        self.assertEqual(eligible_records([support, derived], NOW), [])

    def test_review_fingerprint_ignores_promotion_not_changed_evidence(self):
        record = fact()
        promoted = deepcopy(record)
        promoted["memory_metadata"]["stage"] = "durable"
        promoted["revision"] = "b" * 64
        promoted["updated_at"] = 1234
        self.assertEqual(review_fingerprint(record, []), review_fingerprint(promoted, []))
        promoted["content"] = "Changed claim"
        self.assertNotEqual(review_fingerprint(record, []), review_fingerprint(promoted, []))
        derived = fact("c", evidence=[{"ref": "a" * 64, "revision": "a" * 64, "relation": "supports", "requirement": "historical"}])
        self.assertNotEqual(review_fingerprint(derived, [record]), review_fingerprint(derived, [promoted]))
