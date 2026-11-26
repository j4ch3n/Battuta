import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from agent_memory.core import reasoning
from agent_memory.core.watermark import Watermark
from battuta_memory.archive import ingest
from battuta_memory.dream import DreamState, run_dream
from battuta_memory.manage import BattutaManage
from battuta_memory.overview import active_overviews
from battuta_memory.reads import Reads
from helpers import entity, make_store


def upload(store, *lines):
    body = "\n".join(json.dumps({"entry_id": f"e-{abs(hash(text))}", "conversation_id": "c1", "speaker": speaker, "text": text,
                                 "timestamp": f"2026-11-26T09:0{index}:00+00:00"}) for index, (speaker, text) in enumerate(lines))
    ingest(store, body.encode())


class StubDistiller:
    """Answers the library's text protocol with prepared operations, like a model would."""

    def __init__(self, *operations):
        self.operations = list(operations)
        self.prompts = []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        return "\n".join(json.dumps({"op": "new", **operation}) for operation in self.operations)


class StubOverview:
    def __init__(self):
        self.projects = []

    def __call__(self, prompt):
        project = prompt.split('("', 1)[1].split('")', 1)[0]
        self.projects.append(project)
        memories = prompt.split("## Memories", 1)[1].strip()
        return json.dumps({"abstract": f"{project} line", "body": f"Digest of {project}:\n{memories}"})


def no_review(_prompt):
    return ""


class DreamTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self, distill_view=True)
        self.state = DreamState(self.store.root)
        self.state.start(os.getpid())

    def dream(self, distiller, overview, today="2026-11-26"):
        return run_dream(self.store, self.state, write_reasoner=distiller, manage_reasoner=no_review, ask=overview,
                         catalog=lambda: ["battuta", "mocktest"], today=today)

    def test_dream_distills_backlog_and_writes_overview(self):
        upload(self.store, ("owner", "I'm Jason, CEO of Fiscum"), ("owner", "MockTest's client is Acme Ltd"), ("cos", "Noted."))
        distiller = StubDistiller(
            {"type": "profile", "fields": {"project": "global", "subject": "name"}, "abstract": "The owner is Jason, CEO of Fiscum", "body": "Jason is CEO of Fiscum."},
            {"type": "entity", "fields": {"project": "mocktest", "subject": "acme-ltd"}, "abstract": "Acme Ltd is the MockTest client", "body": "Client."})
        overview = StubOverview()
        report = self.dream(distiller, overview)
        names = {record.path.relative_to(self.store.root).as_posix() for record in self.store.records()}
        self.assertLessEqual({"profile/global/global-profile-name.md", "entity/mocktest/mocktest-entity-acme-ltd.md",
                              "overview/global/global-overview-2026-11-26.md", "overview/mocktest/mocktest-overview-2026-11-26.md"}, names)
        self.assertIn("Set fields.project to one of: battuta, global, mocktest", distiller.prompts[0])
        self.assertNotIn("- overview (", distiller.prompts[0])
        self.assertEqual(sorted(report["overviews"]), ["global", "mocktest"])
        self.assertIn("CEO of Fiscum", Reads(self.store).profile()["body"])
        self.assertEqual(Watermark(self.store.layout).read("cos-2026-11-26").backlog(), 0)
        self.assertEqual(self.state.read()["status"], "succeeded")
        self.assertIsNotNone(self.state.read()["last_success_at"])

    def test_second_dream_supersedes_previous_overview_and_skips_unchanged(self):
        upload(self.store, ("owner", "MockTest's client is Acme Ltd"))
        self.dream(StubDistiller({"type": "entity", "fields": {"project": "mocktest", "subject": "acme-ltd"}, "abstract": "Acme Ltd is the MockTest client"}), StubOverview())
        self.state.start(os.getpid())
        upload(self.store, ("owner", "MockTest now launches on 2027-04-15"))
        overview = StubOverview()
        self.dream(StubDistiller({"type": "fact", "fields": {"project": "mocktest", "subject": "launch-date"}, "abstract": "MockTest launches on 2027-04-15"}), overview, today="2026-11-27")
        self.assertEqual(overview.projects, ["mocktest"])
        current = active_overviews(self.store, "mocktest")
        self.assertEqual([record.name for record in current], ["mocktest-overview-2026-11-27"])
        old = self.store.find("mocktest-overview-2026-11-26")
        self.assertFalse(old.is_active())
        self.assertEqual(old.superseded_by, "mocktest-overview-2026-11-27")

    def test_same_day_dreams_give_each_overview_its_own_name_and_file(self):
        for index, text in enumerate(("MockTest's client is Acme Ltd", "MockTest now launches on 2027-04-15")):
            self.state.start(os.getpid())
            upload(self.store, ("owner", text))
            self.dream(StubDistiller({"type": "fact", "fields": {"project": "mocktest", "subject": f"fact-{index}"}, "abstract": text}), StubOverview())
        current = active_overviews(self.store, "mocktest")
        self.assertEqual([record.name for record in current], ["mocktest-overview-2026-11-26-2"])
        self.assertEqual(current[0].path.stem, current[0].name)
        self.assertEqual(self.store.find("mocktest-overview-2026-11-26").superseded_by, "mocktest-overview-2026-11-26-2")

    def test_unchanged_store_makes_no_overview_call(self):
        overview = StubOverview()
        self.dream(StubDistiller(), overview)
        self.assertEqual(overview.projects, [])

    def test_distill_failure_keeps_watermark_and_records_failed_step(self):
        upload(self.store, ("owner", "MockTest's client is Acme Ltd"))

        def broken(_prompt):
            raise RuntimeError("host unavailable")

        with self.assertRaises(RuntimeError):
            self.dream(broken, StubOverview())
        state = self.state.read()
        self.assertEqual((state["status"], state["report"]["failed_step"]), ("failed", "distill"))
        self.assertEqual(Watermark(self.store.layout).read("cos-2026-11-26").backlog(), 1)


class ProposalFilterTests(unittest.TestCase):
    def test_recall_cooccurrence_links_stay_within_one_project(self):
        store = make_store(self)
        for project, subject in (("battuta", "acme"), ("mocktest", "acme"), ("mocktest", "invoices")):
            store.record(**entity(project, subject, f"Acme Ltd invoices for {project} {subject}"))
        with store.overview_writes():
            store.record(type="overview", fields={"project": "mocktest", "subject": "2026-11-26"}, abstract="Acme Ltd invoices digest", body="Acme Ltd invoices")
        for _ in range(3):
            Reads(store).recall(query="Acme Ltd invoices")
        BattutaManage(store).sleep(reasoner=no_review)
        links = {record.name: set(record.links) for record in store.records()}
        self.assertEqual(links["mocktest-entity-acme"], {"mocktest-entity-invoices"})
        self.assertEqual(links["battuta-entity-acme"], set())
        self.assertEqual(links["mocktest-overview-2026-11-26"], set())

    def test_filters_cross_project_and_overview_proposals(self):
        store = make_store(self)
        store.record(**entity("battuta", "acme", "Acme Ltd is the client paying monthly invoices"))
        store.record(**entity("mocktest", "acme", "Acme Ltd is the client paying monthly invoices"))
        self.assertEqual(BattutaManage(store).proposals(), [])
        store.record(**entity("battuta", "acme-ltd", "Acme Ltd is the client paying monthly invoices"))
        kinds = [(proposal.kind, sorted(proposal.targets)) for proposal in BattutaManage(store).proposals()]
        self.assertIn((reasoning.PROPOSAL_SUPERSEDE, ["battuta-entity-acme", "battuta-entity-acme-ltd"]), kinds)
        with store.overview_writes():
            store.record(type="overview", fields={"project": "battuta", "subject": "2026-11-26"}, abstract="x", body="Acme Ltd is the client paying monthly invoices")
        self.assertTrue(all("battuta-overview-2026-11-26" not in proposal.targets for proposal in BattutaManage(store).proposals()))


class ToolkitSessionTests(unittest.TestCase):
    def test_toolkit_session_serves_battuta_rules(self):
        from agent_memory.core import reconcile
        from agent_memory.core.config import Config
        from agent_memory.core.toolkit import WriteToolkit
        store = make_store(self)
        config = Config.load(store.root)
        config.index.vector_enabled = False
        config.save(store.root)
        upload(store, ("owner", "MockTest's client is Acme Ltd"))
        from agent_memory.core import sessions
        messages = sessions.read(store.layout, "cos-2026-11-26")
        sheet = reconcile.build(store, "cos-2026-11-26", messages)
        seed = Path(store.root).parent / "seed"
        seed.mkdir()
        WriteToolkit(store, sheet).save_seed(seed)
        requests = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
                    {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "submit_operations", "arguments": {"operations": [
                        {"op": "new", "type": "overview", "fields": {"project": "mocktest", "subject": "x"}, "abstract": "digest", "body": "b"}]}}}]
        completed = subprocess.run([sys.executable, "-m", "battuta_memory.toolkit_write", str(seed)], input="\n".join(map(json.dumps, requests)) + "\n",
                                   capture_output=True, text=True, timeout=60, check=True)
        replies = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
        result = replies[-1]["result"]
        self.assertTrue(result["isError"])
        self.assertIn("overview", result["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
