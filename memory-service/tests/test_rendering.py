import unittest
from datetime import datetime, timezone
from test_records import fact
from battuta_memory.rendering import render_memories


class RenderingTests(unittest.TestCase):
    def test_whole_claim_and_counter_must_fit_together(self):
        support = fact()
        counter = {**fact(), "ref": "b" * 64, "content": "Contrary event " * 200}
        claim = {**fact(), "ref": "c" * 64, "content": "Possible pattern"}
        claim["memory_metadata"] = {**claim["memory_metadata"], "knowledge_type": "hypothesis", "confidence": "tentative",
            "rationale": "Possible explanation", "evidence": [
                {"ref": support["ref"], "revision": support["revision"], "relation": "supports", "requirement": "historical"},
                {"ref": counter["ref"], "revision": counter["revision"], "relation": "contradicts", "requirement": "historical"}]}
        view = render_memories([claim], [support, counter, claim], datetime.now(timezone.utc))
        self.assertNotIn("Possible pattern", view["context"])
        self.assertTrue(view["incomplete"])
        self.assertLessEqual(len(view["context"].encode()), 2000)

    def test_attributed_fact_is_rendered_without_raw_metadata_dump(self):
        record = fact()
        view = render_memories([record], [record], datetime.now(timezone.utc))
        self.assertIn(record["content"], view["context"])
        self.assertIn(record["ref"], view["context"])
        self.assertNotIn('"memory_metadata"', view["context"])
