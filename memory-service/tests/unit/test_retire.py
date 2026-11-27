import dataclasses
import datetime as dt
import inspect
import json
from pathlib import Path
from unittest import mock

import pytest
from agent_memory.core import reasoning
from agent_memory.core.clock import FrozenClock
from agent_memory.core.ledger import VERDICT_ACCEPTED, VERDICT_REJECTED, Decision
from agent_memory.core.manage import DreamReport, Manage, Proposal
from agent_memory.core.store import Store
from battuta_memory.manage import BattutaManage

TODAY = dt.datetime.now(dt.UTC).date()


def days_ago(days):
    return (TODAY - dt.timedelta(days=days)).isoformat()


def accepting(ids):
    """The core text protocol: one JSON verdict per line."""
    def reviewer(_prompt):
        return "\n".join(json.dumps({reasoning.FIELD_PROPOSAL: proposal_id, reasoning.FIELD_VERDICT: reasoning.VERDICT_ACCEPT})
                         for proposal_id in ids)
    return reviewer


@pytest.fixture
def manage(store):
    return BattutaManage(store)


def write(store, kind, subject, abstract, body="", days=None, project="battuta"):
    fields = {"project": project, "subject": subject}
    spec = {"type": kind, "fields": fields, "abstract": abstract, "body": body or abstract}
    if kind == "event":
        fields["date"] = days_ago(days if days is not None else 0)
    if days is not None:
        spec["valid_from"] = days_ago(days)
    return store.record(**spec)


def deletes(proposals):
    return {proposal.targets[0]: proposal for proposal in proposals if proposal.kind == reasoning.PROPOSAL_DELETE}


def test_declaration_drafts_only_active_named_slugs(store, manage):
    active = write(store, "fact", "old-pricing", "Pricing is 10 GBP")
    gone = write(store, "fact", "older-pricing", "Pricing is 8 GBP")
    store.delete(gone.name)
    declaration = write(store, "fact", "pricing-review", "Pricing review",
                        f"The owner said {active.name} is obsolete. Also {gone.name} and battuta-fact-never-existed are stale. "
                        "battuta-fact-pricing-review supersedes them.")
    assert declaration.name == "battuta-fact-pricing-review"
    drafted = deletes(manage.proposals())
    assert active.name in drafted
    assert not {gone.name, "battuta-fact-never-existed", declaration.name} & drafted.keys()
    assert drafted[active.name].reason == f"The owner said {active.name} is obsolete."
    assert drafted[active.name].evidence == f"declared by {declaration.name}; slug {active.name}"


def test_declaration_without_cue_drafts_nothing(store, manage):
    target = write(store, "fact", "office", "The office is in Leeds")
    write(store, "fact", "office-note", "Office note", f"See {target.name} for the address.")
    assert target.name not in deletes(manage.proposals())


@pytest.mark.parametrize("kind", ["preference", "decision"])
def test_preference_and_decision_drafted_only_by_declaration(store, manage, kind):
    named = write(store, kind, "named", f"Named {kind}", days=90)
    quiet = write(store, kind, "quiet", f"Quiet {kind}", days=90)
    write(store, "fact", "cleanup", "Cleanup", f"{named.name} is no longer true.")
    drafted = deletes(manage.proposals())
    assert named.name in drafted
    assert quiet.name not in drafted


@pytest.mark.parametrize("kind", ["event", "commitment", "experience"])
def test_staleness_rule_drafts_old_never_recalled_dated_entries(store, manage, kind):
    record = write(store, kind, "old", f"Old {kind} entry", days=60)
    drafted = deletes(manage.proposals(records=store.records(), hits={}))
    proposal = drafted[record.name]
    assert proposal.reason.startswith(f"stale by rule: {kind} dated {record.valid_from}, never recalled, ")
    assert proposal.reason.endswith(" days old")
    assert proposal.evidence == f"valid_from={record.valid_from}; created={record.created}; hits=0"


@pytest.mark.parametrize(("kind", "days", "recalled"), [
    ("event", 10, False),
    ("event", 30, False),
    ("commitment", 60, True),
    ("preference", 60, False),
    ("decision", 60, False),
    ("fact", 60, False),
])
def test_staleness_rule_exclusions(store, kind, days, recalled):
    record = write(store, kind, "entry", f"Some {kind} entry", days=days)
    hits = {record.name: 1} if recalled else {}
    # Midnight today, so an entry dated 30 days ago is exactly 30 days old.
    midnight = BattutaManage(store, clock=FrozenClock(dt.datetime.combine(TODAY, dt.time(), tzinfo=dt.UTC)))
    assert record.name not in deletes(midnight.proposals(records=store.records(), hits=hits))


def test_staleness_uses_created_without_valid_from_and_skips_overview(store):
    event = write(store, "event", "kickoff", "Kickoff happened")
    future = BattutaManage(store, clock=FrozenClock(dt.datetime.now(dt.UTC) + dt.timedelta(days=40)))
    records = [dataclasses.replace(record, valid_from=None) for record in store.records()]
    drafted = deletes(future.proposals(records=records, hits={}))
    assert "valid_from=none" in drafted[event.name].evidence
    assert f"dated {event.created}" in drafted[event.name].reason
    overview = dataclasses.replace(records[0], type="overview")
    assert future._propose_stale([overview], {}) == []


def test_caps_apply_three_deletes_and_withhold_the_rest(store, manage):
    events = {write(store, "event", f"meeting-{index}", f"Meeting number {index} took place", days=60).name for index in range(5)}
    ids = [proposal.id for proposal in manage.proposals() if proposal.kind == reasoning.PROPOSAL_DELETE]
    assert len(ids) == 5
    report = manage.sleep(accepting(ids))
    assert len([decision for decision in report.decisions if decision.verdict == VERDICT_ACCEPTED]) == 3
    assert len(report.withheld) == 2
    assert len([record for record in store.records() if record.name in events]) == 2


def test_ledger_detail_carries_reason_and_evidence(store, manage):
    target = write(store, "fact", "old-plan", "The old plan")
    write(store, "fact", "plan-change", "Plan change", f"{target.name} is outdated.")
    proposal = deletes(manage.proposals())[target.name]
    decision = manage.decide(proposal.id, accept=True)
    expected = f"marked {target.name} invalid - {target.name} is outdated. [declared by battuta-fact-plan-change; slug {target.name}]"
    assert decision.detail == expected
    ledger = (store.layout.dream_reports / "decisions.md").read_text(encoding="utf-8")
    assert f"- {proposal.id} accepted {decision.at} — {expected}\n" in ledger


def test_supersede_detail_carries_reason_on_one_line(store, manage):
    keeper = write(store, "fact", "keeper", "Keeper entry with the longer body", "A much longer body that wins the keeper choice.")
    loser = write(store, "fact", "loser", "Loser entry", "Short.")
    supersede = Proposal(reasoning.PROPOSAL_SUPERSEDE, (keeper.name, loser.name), "same\nfact", "near\n duplicate")
    assert manage._supersede(supersede, {}) == f"kept {keeper.name} - same fact [near duplicate]"


def test_multiline_declaration_reason_is_one_line(store, manage):
    target = write(store, "fact", "old-office", "Old office")
    write(store, "fact", "office-move", "Office move", f"Per the owner\n  {target.name}\n\tis   no longer\nvalid.")
    proposal = deletes(manage.proposals())[target.name]
    assert proposal.reason == f"Per the owner {target.name} is no longer valid."
    decision = manage.decide(proposal.id, accept=True)
    assert "\n" not in decision.detail
    assert "is no longer valid." in decision.detail


def test_retired_section_lists_accepted_retirements(manage):
    delete = Proposal(reasoning.PROPOSAL_DELETE, ("battuta-fact-a",), "a is stale", "declared by x; slug battuta-fact-a")
    supersede = Proposal(reasoning.PROPOSAL_SUPERSEDE, ("battuta-fact-b", "battuta-fact-c"), "b repeats c", "similarity=0.9")
    rejected = Proposal(reasoning.PROPOSAL_DELETE, ("battuta-fact-d",), "d is stale", "e")
    withheld = Proposal(reasoning.PROPOSAL_DELETE, ("battuta-fact-e",), "e is stale", "e")
    for proposal in (delete, supersede, rejected, withheld):
        manage._drafted[proposal.id] = proposal
    at = "2026-11-27T01:02:03+00:00"
    decisions = (Decision(delete.id, VERDICT_ACCEPTED, at, "marked battuta-fact-a invalid"),
                 Decision(supersede.id, VERDICT_ACCEPTED, at, "kept battuta-fact-c"),
                 Decision(rejected.id, VERDICT_REJECTED, at),
                 Decision("0123456789ab", VERDICT_ACCEPTED, at, "marked battuta-fact-z invalid - old [ev]"))
    report = DreamReport(at=at, actions=(), proposals=(), inspected=0, decisions=decisions, withheld=(withheld.id,))
    section = Path(manage._write_report(report)).read_text(encoding="utf-8").split("## retired\n\n", 1)[1]
    assert section.splitlines() == [
        f"- delete battuta-fact-a — a is stale [declared by x; slug battuta-fact-a] (proposal {delete.id}, decided {at})",
        f"- supersede battuta-fact-b, battuta-fact-c — b repeats c [similarity=0.9] (proposal {supersede.id}, decided {at})",
        f"- marked battuta-fact-z invalid - old [ev] (proposal 0123456789ab, decided {at})",
    ]
    assert "battuta-fact-d" not in section
    assert "battuta-fact-e" not in section


def test_retired_section_says_none_when_nothing_retired(manage):
    empty = DreamReport(at="2026-11-27T01:02:03+00:00", actions=(), proposals=(), inspected=0, dream_id="empty")
    text = Path(manage._write_report(empty)).read_text(encoding="utf-8")
    assert text.endswith("## retired\n\n- none\n")
    assert "## applied" in text


def test_sleep_report_names_the_retirement(store, manage):
    target = write(store, "event", "retro", "Retro happened", days=60)
    proposal = deletes(manage.proposals())[target.name]
    report = manage.sleep(accepting([proposal.id]))
    text = Path(report.path).read_text(encoding="utf-8")
    assert f"- delete {target.name} — {proposal.reason} [{proposal.evidence}] (proposal {proposal.id}, decided " in text


def test_retired_file_is_retained_with_invalid_at(store, manage):
    target = write(store, "event", "offsite", "Offsite happened", days=60)
    proposal = deletes(manage.proposals())[target.name]
    with mock.patch.object(Store, "gc") as gc:
        report = manage.sleep(accepting([proposal.id]))
    gc.assert_not_called()
    assert [decision.verdict for decision in report.decisions] == [VERDICT_ACCEPTED]
    retained = {record.name: record for record in store.records(include_invalid=True)}[target.name]
    assert retained.invalid_at is not None
    assert retained.path.exists()
    assert target.name not in {record.name for record in store.records()}


# Update with any agent-memory core bump, after re-reading the hooks BattutaManage overrides.
@pytest.mark.parametrize(("owner", "name", "signature"), [
    (Manage, "proposals", "(self, records: 'list[MemoryRecord] | None' = None, hits: 'dict[str, int] | None' = None) -> 'list[Proposal]'"),
    (Manage, "sleep", "(self, reasoner: 'reasoning.Reasoner | None' = None, *, dream_id: 'str' = '') -> 'DreamReport'"),
    (Manage, "_caps", "(self) -> 'dict[str, int]'"),
    (Manage, "_delete", "(self, proposal: 'Proposal', expected: 'dict[str, str]') -> 'str'"),
    (Manage, "_supersede", "(self, proposal: 'Proposal', expected: 'dict[str, str]') -> 'str'"),
    (Manage, "_write_report", "(self, report: 'DreamReport') -> 'str'"),
    (Store, "delete", "(self, name: 'str', *, expected_source_hash: 'str | None' = None) -> 'MemoryRecord'"),
])
def test_private_core_hook_signatures_unchanged(owner, name, signature):
    assert str(inspect.signature(getattr(owner, name))) == signature
