import json
import os
import unittest
from unittest import mock

from agent_memory.core.ledger import DecisionLedger
from agent_memory.core.store import Store

from battuta_memory.dream import DreamState
from battuta_memory.forget import SOFT_MAX_FORGET, forget
from battuta_memory.reads import Reads
from helpers import entity, make_store

CONFIRM = {"reason": "Acme left the project", "owner_confirmation": "Owner said: forget Acme"}


class ForgetTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self)
        self.ledger_path = self.store.layout.dream_reports / "decisions.md"

    def add(self, subject, abstract=None, project="mocktest"):
        return self.store.record(**entity(project, subject, abstract or f"{subject} is a contact for {project}")).name

    def snapshot(self):
        return {path: path.read_bytes() for path in self.store.layout.truth_files()}

    def assert_rejected_without_writes(self, arguments, message=None):
        before = self.snapshot()
        with self.assertRaises(ValueError) as caught:
            forget(self.store, arguments)
        if message:
            self.assertIn(message, str(caught.exception))
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.ledger_path.exists())
        return caught.exception

    def call(self, entries, **extra):
        return forget(self.store, {"entries": entries, **CONFIRM, **extra})

    def test_delete_marks_forgotten(self):
        slug = self.add("acme-ltd")
        result = self.call([{"slug": slug}])["results"][0]
        record = self.store.find(slug)
        self.assertEqual((result["slug"], result["result"]), (slug, "forgotten"))
        self.assertIsNotNone(record.invalid_at)
        self.assertEqual(result["invalid_at"], record.invalid_at)
        self.assertIsNone(record.superseded_by)
        self.assertNotIn("successor", result)

    def test_supersede_marks_superseded(self):
        old, new = self.add("acme-ltd"), self.add("acme-group")
        result = self.call([{"slug": old, "successor": new}])["results"][0]
        record = self.store.find(old)
        self.assertEqual((result["result"], result["successor"]), ("superseded", new))
        self.assertEqual(record.superseded_by, new)
        self.assertEqual(result["invalid_at"], record.invalid_at)
        self.assertTrue(self.store.find(new).is_active())

    def test_batch_soft_cap(self):
        self.assert_rejected_without_writes({"entries": [], **CONFIRM}, "non-empty")
        slugs = [self.add(f"contact-{index}") for index in range(SOFT_MAX_FORGET + 1)]
        within = self.call([{"slug": slug} for slug in slugs[:SOFT_MAX_FORGET]])
        self.assertNotIn("warning", within)
        self.assertIn(str(SOFT_MAX_FORGET), within["message"])
        over = self.call([{"slug": slug} for slug in slugs])
        self.assertIn("warning", over)
        self.assertEqual([result["result"] for result in over["results"]], ["no-op"] * SOFT_MAX_FORGET + ["forgotten"])
        self.assertFalse(self.store.find(slugs[-1]).is_active())

    def test_reason_and_confirmation_required(self):
        slug = self.add("acme-ltd")
        for key in ("reason", "owner_confirmation"):
            for value in (None, "", "   ", 3):
                with self.subTest(key=key, value=value):
                    arguments = {"entries": [{"slug": slug}], **CONFIRM}
                    if value is None:
                        del arguments[key]
                    else:
                        arguments[key] = value
                    self.assert_rejected_without_writes(arguments, key)

    def test_bad_entry_shapes_rejected(self):
        slug = self.add("acme-ltd")
        for entries in ("x", [slug], [{"slug": ""}], [{"slug": slug, "successor": " "}], [{"slug": slug, "extra": 1}], [{}]):
            with self.subTest(entries=entries):
                self.assert_rejected_without_writes({"entries": entries, **CONFIRM})

    def test_unknown_slug_rejects_whole_batch(self):
        first, second = self.add("acme-ltd"), self.add("beta-ltd")
        error = self.assert_rejected_without_writes(
            {"entries": [{"slug": first}, {"slug": "nope-one"}, {"slug": second}, {"slug": "nope-two"}], **CONFIRM})
        self.assertIn("nope-one", str(error))
        self.assertIn("nope-two", str(error))
        self.assertTrue(self.store.find(first).is_active())
        self.assertTrue(self.store.find(second).is_active())

    def test_missing_or_inactive_successor_rejected(self):
        old, retired = self.add("acme-ltd"), self.add("acme-old")
        self.store.delete(retired)
        before_ledger = self.ledger_path.exists()
        self.assertFalse(before_ledger)
        self.assert_rejected_without_writes({"entries": [{"slug": old, "successor": "missing-slug"}], **CONFIRM}, "missing-slug")
        self.assert_rejected_without_writes({"entries": [{"slug": old, "successor": retired}], **CONFIRM}, retired)
        self.assertTrue(self.store.find(old).is_active())

    def test_already_invalid_is_noop(self):
        plain, superseded, successor = self.add("acme-ltd"), self.add("acme-old"), self.add("acme-group")
        self.store.delete(plain)
        self.store.delete(superseded)
        invalid = {slug: self.store.find(slug).invalid_at for slug in (plain, superseded)}
        before = self.snapshot()
        results = self.call([{"slug": plain}, {"slug": superseded, "successor": successor}])["results"]
        self.assertEqual([(r["slug"], r["result"], r["invalid_at"]) for r in results],
                         [(plain, "no-op", invalid[plain]), (superseded, "no-op", invalid[superseded])])
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.ledger_path.exists())

    def test_file_is_kept(self):
        slug = self.add("acme-ltd")
        path = self.store.find(slug).path
        self.call([{"slug": slug}])
        self.assertTrue(path.exists())
        self.assertIsNotNone(self.store.find(slug).invalid_at)
        self.assertIn(slug, [record.name for record in self.store.records(include_invalid=True)])
        self.assertNotIn(slug, [record.name for record in self.store.records()])

    def test_recall_hides_forgotten(self):
        slug, other = self.add("acme-ltd", "Acme Ltd is the client"), self.add("beta-ltd", "Beta Ltd is a supplier")
        reads = Reads(self.store)
        self.assertIn(slug, [m["name"] for m in reads.recall(query="Acme client")["memories"]])
        self.call([{"slug": slug}])
        self.assertNotIn(slug, [m["name"] for m in reads.recall(query="Acme client")["memories"]])
        names = [m["name"] for m in reads.recall(projects=["mocktest"])["memories"]]
        self.assertNotIn(slug, names)
        self.assertIn(other, names)

    def test_ledger_audit_line(self):
        slug, old, new = self.add("acme-ltd"), self.add("beta-old"), self.add("beta-new")
        results = self.call([{"slug": slug}, {"slug": old, "successor": new}])["results"]
        decided = DecisionLedger(self.store.layout).decided()
        self.assertEqual(set(decided), {f"forget:{slug}", f"forget:{old}"})
        forgotten = json.loads(decided[f"forget:{slug}"].detail)
        self.assertEqual(decided[f"forget:{slug}"].verdict, "accepted")
        self.assertEqual(forgotten, {"action": "forgotten", "invalid_at": results[0]["invalid_at"], "successor": None,
                                     "reason": CONFIRM["reason"], "owner_confirmation": CONFIRM["owner_confirmation"], "by": "cos"})
        superseded = json.loads(decided[f"forget:{old}"].detail)
        self.assertEqual((superseded["action"], superseded["successor"], superseded["invalid_at"]), ("superseded", new, results[1]["invalid_at"]))

    def test_ledger_detail_stays_one_line(self):
        slug = self.add("acme-ltd")
        forget(self.store, {"entries": [{"slug": slug}], "reason": "line one\nline two — café", "owner_confirmation": "yes"})
        detail = json.loads(DecisionLedger(self.store.layout).decided()[f"forget:{slug}"].detail)
        self.assertEqual(detail["reason"], "line one\nline two — café")

    def test_ledger_failure_reports_applied_with_missing_audit(self):
        slug, later = self.add("acme-ltd"), self.add("beta-ltd")
        path = self.store.find(slug).path
        with mock.patch.object(DecisionLedger, "append", side_effect=OSError("disk full")):
            reply = self.call([{"slug": slug}, {"slug": later}])
        self.assertIsNotNone(self.store.find(slug).invalid_at)
        self.assertTrue(path.exists())
        self.assertTrue(self.store.find(later).is_active())
        self.assertEqual(reply["applied"], [slug])
        self.assertEqual(reply["audit_missing"], [slug])
        self.assertEqual(reply["not_processed"], [later])
        self.assertEqual(len(reply["results"]), 1)
        result = reply["results"][0]
        self.assertEqual((result["slug"], result["result"], result["audit_missing"]), (slug, "forgotten", True))
        self.assertIn(slug, result["error"])
        self.assertIn("OSError", result["error"])
        self.assertIn("audit record is MISSING", reply["error"])
        self.assertFalse(self.ledger_path.exists())

    def test_gc_never_called(self):
        slug, old, new = self.add("acme-ltd"), self.add("beta-old"), self.add("beta-new")
        with mock.patch.object(Store, "gc", side_effect=AssertionError("gc must not run")) as gc:
            self.call([{"slug": slug}, {"slug": old, "successor": new}])
        gc.assert_not_called()

    def test_duplicate_self_and_in_batch_successor_rejected(self):
        first, second, third = self.add("acme-ltd"), self.add("beta-ltd"), self.add("gamma-ltd")
        cases = (([{"slug": first}, {"slug": first}], "duplicate"),
                 ([{"slug": first, "successor": first}], "itself"),
                 ([{"slug": first, "successor": second}, {"slug": second}], "also being forgotten"),
                 ([{"slug": third}, {"slug": first, "successor": third}], "also being forgotten"))
        for entries, message in cases:
            with self.subTest(entries=entries):
                self.assert_rejected_without_writes({"entries": entries, **CONFIRM}, message)

    def test_rejected_while_dream_running(self):
        slug = self.add("acme-ltd")
        DreamState(self.store.root).start(os.getpid())
        self.assert_rejected_without_writes({"entries": [{"slug": slug}], **CONFIRM}, "dream")
        DreamState(self.store.root).finish(True, report={})
        self.assertEqual(self.call([{"slug": slug}])["results"][0]["result"], "forgotten")


if __name__ == "__main__":
    unittest.main()
