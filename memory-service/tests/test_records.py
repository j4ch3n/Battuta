from datetime import datetime, timezone
import unittest

from battuta_memory.contracts import MemoryMetadata
from battuta_memory.records import decode_record, eligible_records


NOW = datetime(2026, 11, 6, tzinfo=timezone.utc)
SOURCE = {"agent_id": "cos", "session_id": "s", "entry_id": "e"}


def fact(ref="a", **metadata):
    return {"ref": ref * 64, "revision": ref * 64, "content": "Owner reported a purchase", "active": True,
        "scope": {"projects": ["global"]}, "sources": [SOURCE], "kind": "event", "tags": [],
        "memory_metadata": {"knowledge_type": "fact", "confidence": "confirmed",
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
        for change in ({"sources": []}, {"scope": {"projects": []}}, {"memory_metadata": {"knowledge_type": "unknown"}}):
            record = {**fact(), **change}
            self.assertEqual(decode_record(record)["ref"], "a" * 64)
            self.assertEqual(eligible_records([record], NOW), [])
        legacy = fact()
        del legacy["memory_metadata"]
        self.assertIsNone(decode_record(legacy).get("memory_metadata"))

    def test_historical_support_can_expire_but_withdrawal_revision_and_cycles_suppress_dependents(self):
        support = fact(expires_at="2026-11-02T00:00:00Z")
        derived = fact("b", knowledge_type="inference", confidence="tentative", rationale="Possible pattern", evidence=[{
            "ref": "a" * 64, "revision": "a" * 64, "relation": "supports", "requirement": "historical"}])
        self.assertEqual([r["ref"] for r in eligible_records([support, derived], NOW)], ["b" * 64])
        for change in ({"active": False}, {"revision": "c" * 64}):
            self.assertEqual(eligible_records([{**support, **change}, derived], NOW), [])
        derived["memory_metadata"]["evidence"][0]["requirement"] = "current"
        self.assertEqual(eligible_records([support, derived], NOW), [])

    def test_inference_needs_rationale_and_support_and_cannot_be_confirmed(self):
        link = {"ref": "a" * 64, "revision": "a" * 64, "relation": "supports", "requirement": "current"}
        for change in ({}, {"rationale": "Why"}, {"evidence": [link]}, {"rationale": "Why", "evidence": [link]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                MemoryMetadata.model_validate(fact(knowledge_type="inference", confidence="confirmed" if change.get("evidence") else "tentative", **change)["memory_metadata"])

    def test_removed_lifecycle_fields_are_ignored(self):
        decoded = MemoryMetadata.model_validate(fact(stage="durable", status="rejected")["memory_metadata"])
        self.assertFalse({"stage", "status"} & decoded.model_dump().keys())

    def test_evidence_projects_must_be_subset_of_claim_projects(self):
        support = {**fact(), "scope": {"projects": ["atlas", "global"]}}
        link = [{"ref": "a" * 64, "revision": "a" * 64, "relation": "supports", "requirement": "current"}]
        for projects, expected in ((["atlas", "global", "beacon"], 1), (["atlas", "global"], 1), (["atlas"], 0), (["global"], 0)):
            claim = {**fact("b", knowledge_type="inference", confidence="tentative", rationale="Why", evidence=link), "scope": {"projects": projects}}
            with self.subTest(projects=projects):
                self.assertEqual(len([r for r in eligible_records([support, claim], NOW) if r["ref"] == "b" * 64]), expected)
