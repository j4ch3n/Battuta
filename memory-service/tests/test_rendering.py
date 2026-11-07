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

    def test_rendered_model_text_redacts_credentials_without_changing_canonical_record(self):
        record = {**fact(), "content": "API token is sk-abcdefghijklmnopqrstuv"}
        view = render_memories([record], [record], datetime.now(timezone.utc))
        self.assertNotIn("sk-abcdefghijklmnopqrstuv", view["context"])
        self.assertIn("REDACTED", view["context"])
        self.assertEqual(record["content"], "API token is sk-abcdefghijklmnopqrstuv")

    def test_counterevidence_is_explicitly_related_to_the_claim(self):
        for nested in (False, True):
            with self.subTest(nested=nested):
                support = fact()
                counter = {**fact(), "ref": "b" * 64, "content": "Owner explicitly disliked that activity"}
                claim = {**fact(), "ref": "c" * 64, "content": "Owner may like that activity"}
                contrary = {"ref": counter["ref"], "revision": counter["revision"], "relation": "contradicts", "requirement": "historical"}
                claim["memory_metadata"] = {**claim["memory_metadata"], "knowledge_type": "hypothesis", "confidence": "tentative",
                    "rationale": "Possible pattern", "evidence": [{"ref": support["ref"], "revision": support["revision"], "relation": "supports", "requirement": "historical"}]}
                if nested:
                    support["memory_metadata"]["evidence"] = [contrary]
                else:
                    claim["memory_metadata"]["evidence"].append(contrary)
                view = render_memories([claim], [support, counter, claim], datetime.now(timezone.utc))
                self.assertIn("Counterevidence against " + claim["ref"], view["context"])
                self.assertIn(counter["content"], view["context"])
                self.assertFalse(view["incomplete"])
