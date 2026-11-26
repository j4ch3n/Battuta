import unittest
from unittest import mock

from battuta_memory.reads import Reads
from helpers import entity, make_store


def overview(store, project, day, abstract, body):
    with store.overview_writes():
        return store.record(type="overview", fields={"project": project, "subject": day}, abstract=abstract, body=body)


class ReadTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self)
        self.reads = Reads(self.store)

    def test_project_overview_ok_one_and_several_newest_first(self):
        with mock.patch.object(self.store.clock, "timestamp", return_value="2026-11-25T05:00:00+00:00"):
            overview(self.store, "battuta", "2026-11-25", "Old line", "Old digest.")
        self.assertEqual(self.reads.project_overview("battuta")["overview"]["body"], "Old digest.")
        with mock.patch.object(self.store.clock, "timestamp", return_value="2026-11-26T05:00:00+00:00"):
            overview(self.store, "battuta", "2026-11-26", "New line", "New digest.")
        result = self.reads.project_overview("battuta")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["overview"]["body"], "New digest.\n\nOld digest.")
        self.assertEqual(result["overview"]["abstract"], "New line")

    def test_project_overview_not_written_and_unknown(self):
        self.assertEqual(self.reads.project_overview("battuta"), {"status": "not_written"})
        self.assertEqual(self.reads.project_overview("atlas"), {"status": "unknown_project", "projects": ["battuta", "global", "mocktest"]})

    def test_descriptions_none_for_missing(self):
        overview(self.store, "battuta", "2026-11-26", "AI team project", "Digest.")
        self.assertEqual(self.reads.project_descriptions()["descriptions"], {"battuta": "AI team project", "global": None, "mocktest": None})

    def test_recall_projects_types_query_scopes_to_pair(self):
        self.store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client for MockTest"))
        self.store.record(type="fact", fields={"project": "mocktest", "subject": "client-contract"}, abstract="The Acme client contract runs to 2027")
        self.store.record(**entity("battuta", "acme-ltd", "Acme Ltd also advises battuta"))
        result = self.reads.recall(projects=["mocktest"], types=["entity"], query="who is the client")
        self.assertEqual([memory["name"] for memory in result["memories"]], ["mocktest-entity-acme-ltd"])

    def test_recall_projects_only_returns_overview_or_abstracts(self):
        self.store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client", "Signed 2026."))
        abstracts = self.reads.recall(projects=["mocktest"])["memories"]
        self.assertEqual([(m["name"], m["body"]) for m in abstracts], [("mocktest-entity-acme-ltd", "")])
        overview(self.store, "mocktest", "2026-11-26", "Banking prototype", "Client Acme Ltd.")
        self.assertEqual([m["type"] for m in self.reads.recall(projects=["mocktest"])["memories"]], ["overview"])

    def test_recall_rejects_unknown_project_or_type_with_lists(self):
        for arguments in ({"projects": ["atlas"], "query": "x"}, {"types": ["person"], "query": "x"}, {}):
            with self.subTest(arguments=arguments):
                result = self.reads.recall(**arguments)
                self.assertEqual(result["status"], "invalid")
                self.assertIn("mocktest", result["projects"])
                self.assertIn("entity", result["types"])

    def test_query_recall_skips_overviews(self):
        self.store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client for MockTest"))
        overview(self.store, "mocktest", "2026-11-26", "Acme client banking prototype", "Acme Ltd is the client.")
        self.assertEqual([m["type"] for m in self.reads.recall(query="Acme client")["memories"]], ["entity"])

    def test_profile_reads_global_overview(self):
        self.assertEqual(self.reads.profile(), {"status": "not_written"})
        overview(self.store, "global", "2026-11-26", "Jason, CEO of Fiscum", "Jason Chen is the founder and CEO of Fiscum.")
        self.assertEqual(self.reads.profile(), {"status": "ok", "body": "Jason Chen is the founder and CEO of Fiscum."})

    def test_types_lists_conversation_types_only(self):
        self.assertNotIn("overview", [item["type"] for item in self.reads.types()])
        self.assertEqual(len(self.reads.types()), 10)


if __name__ == "__main__":
    unittest.main()
