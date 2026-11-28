import dataclasses
import datetime as dt
import inspect
import json
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
from agent_memory.core import reasoning
from agent_memory.core.ledger import VERDICT_ACCEPTED, VERDICT_REJECTED, Decision
from agent_memory.core.manage import ACTION_DUPLICATE_MERGED, Action, DreamReport, Manage, Proposal
from agent_memory.core.store import Store
from battuta_memory.layout import OVERVIEW
from battuta_memory.manage import BattutaManage, DeclaredProposal, _newer

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


def retire(*names, reason="obsolete"):
    return "".join(f"Retire: {name} - {reason}\n" for name in names)


def declared(manage):
    return {target for proposal in manage.proposals() if isinstance(proposal, DeclaredProposal) for target in proposal.targets}


@pytest.fixture
def target(store):
    return write(store, "fact", "target-entry", "Entry target", days=10)


def slugs(store, *subjects, kind="fact", days=5, project="battuta"):
    return [write(store, kind, subject, f"Entry {subject}", days=days, project=project).name for subject in subjects]


# S2: a valid Retire line drafts exactly its slug.
@pytest.mark.parametrize("kind", ["preference", "decision", "event"])
def test_retire_line_drafts_exactly_its_slug(store, manage, kind):
    named = write(store, kind, "named", f"Named {kind}", days=90)
    quiet = write(store, kind, "quiet", f"Quiet {kind}", days=90)
    note = write(store, "fact", "note", "Cleanup", f"The owner approved this.\n{retire(named.name, reason='superseded by the new plan')}")
    drafted = deletes(manage.proposals())
    assert declared(manage) == {named.name}
    assert quiet.name not in drafted
    assert drafted[named.name].reason == "superseded by the new plan"
    assert drafted[named.name].evidence == f"declared by {note.name}"


@pytest.mark.parametrize("bullet", ["", "- ", "* "])
@pytest.mark.parametrize("separator", [" - ", " — ", ": "])
def test_retire_line_forms(store, manage, target, bullet, separator):
    write(store, "fact", "note", "Note", f"{bullet}Retire: {target.name}{separator}old plan\n")
    assert declared(manage) == {target.name}
    assert deletes(manage.proposals())[target.name].reason == "old plan"


# S2 rejections, one test each.
def test_unknown_slug_drafts_nothing(store, manage, target):
    write(store, "fact", "note", "Note", retire("battuta-fact-never-existed"))
    assert declared(manage) == set()


def test_inactive_slug_drafts_nothing(store, manage, target):
    store.delete(target.name)
    write(store, "fact", "note", "Note", retire(target.name))
    assert declared(manage) == set()


def test_self_declaration_drafts_nothing(store, manage):
    note = write(store, "fact", "note", "Note", retire("battuta-fact-note"))
    assert note.name == "battuta-fact-note"
    assert declared(manage) == set()


def test_inactive_declarer_drafts_nothing(store, manage, target):
    note = write(store, "fact", "note", "Note", retire(target.name))
    store.delete(note.name)
    assert declared(manage) == set()


def test_overview_declarer_drafts_nothing(store, manage, target):
    note = write(store, "fact", "note", "Note", retire(target.name))
    assert [proposal.targets for proposal in manage._propose_declared([note, target])] == [(target.name,)]
    assert manage._propose_declared([dataclasses.replace(note, type=OVERVIEW), target]) == []


def test_other_project_target_drafts_nothing(store, manage):
    (other,) = slugs(store, "x-entry", days=10, project="mocktest")
    write(store, "fact", "note", "Note", retire(other))
    assert declared(manage) == set()


@pytest.mark.parametrize("target_days", [5, -5])
def test_target_not_strictly_older_drafts_nothing(store, manage, target_days):
    (x,) = slugs(store, "x-entry", days=target_days)
    write(store, "fact", "note", "Note", retire(x), days=5)
    assert declared(manage) == set()


@pytest.mark.parametrize("fence", ["```", "~~~"])
def test_retire_line_inside_fence_drafts_nothing(store, manage, fence):
    x, y = slugs(store, "x-entry", "y-entry")
    write(store, "fact", "note", "Note", f"Example:\n{fence}\n{retire(x)}{fence}\n{retire(y)}")
    assert declared(manage) == {y}


@pytest.mark.parametrize("quote", ["> ", ">", "> - "])
def test_retire_line_inside_blockquote_drafts_nothing(store, manage, target, quote):
    write(store, "fact", "note", "Note", f"The owner wrote:\n{quote}{retire(target.name)}")
    assert declared(manage) == set()


@pytest.mark.parametrize("line", [
    "Retire: {upper} - obsolete",
    "retire: {t} - obsolete",
    "RETIRE: {t} - obsolete",
    "Retire:{t} - obsolete",
    "Retire:  {t} - obsolete",
    "  Retire: {t} - obsolete",
    "Retire: `{t}` - obsolete",
    "Retire: {t} {y} - obsolete",
    "Retire: {t}-old - obsolete",
    "Retire: {t} obsolete",
    "+ Retire: {t} - obsolete",
    "1. Retire: {t} - obsolete",
    "Please Retire: {t} - obsolete",
])
def test_malformed_retire_line_drafts_nothing(store, manage, target, line):
    (y,) = slugs(store, "y-entry")
    # A leading line keeps the store's body strip from removing the indentation case's spaces.
    write(store, "fact", "note", "Note", "Cleanup:\n" + line.format(t=target.name, upper=target.name.upper(), y=y) + "\n")
    assert declared(manage) == set()


@pytest.mark.parametrize("line", ["Retire: {t}", "Retire: {t} - ", "Retire: {t} -    ", "Retire: {t} — ", "Retire: {t}: "])
def test_retire_line_without_reason_drafts_nothing(store, manage, target, line):
    write(store, "fact", "note", "Note", line.format(t=target.name) + "\n")
    assert declared(manage) == set()


def test_two_retire_lines_draft_both(store, manage):
    x, y = slugs(store, "x-entry", "y-entry")
    write(store, "fact", "note", "Note", retire(x, y))
    assert declared(manage) == {x, y}


def test_caps_apply_three_deletes_and_withhold_the_rest(store, manage):
    events = {write(store, "event", f"meeting-{index}", f"Meeting number {index} took place", days=60).name for index in range(5)}
    write(store, "fact", "meetings-cleanup", "These meetings are obsolete.",
          "".join(f"- Retire: {name} - meeting is over\n" for name in sorted(events)))
    ids = [proposal.id for proposal in manage.proposals() if proposal.kind == reasoning.PROPOSAL_DELETE]
    assert len(ids) == 5
    report = manage.sleep(accepting(ids))
    assert len([decision for decision in report.decisions if decision.verdict == VERDICT_ACCEPTED]) == 3
    assert len(report.withheld) == 2
    assert len([record for record in store.records() if record.name in events]) == 2


# S1/S3: prose never drafts a retirement.
@pytest.mark.parametrize(("abstract", "body"), [
    ("Note", "Never forget {x}. {y} is not obsolete and still holds."),
    ("Never forget {x}. {y} is not obsolete and still holds.", ""),
    ("Note", "{x} remains in force. {y} is stale."),
    ("Note", "{y} replaced {x}."),
    ("Note", "{x} was replaced by {y}."),
    ("Note", "{x} was superseded by {y}."),
    ("Note", "{x} is obsolete, replaced by {y}."),
    ("Note", "Replace {x} with {y}."),
    ("Note", "{y} replaced {x}, which is obsolete."),
    ("Note", "{y} is current; the old {x} is stale."),
    ("Note", "It is not, as far as anyone knows, true that {x} is obsolete."),
    ("Note", "The owner asked whether {x} is obsolete."),
    ("Note", 'I asked "is {x} outdated?" and the owner said no.'),
    ("These entries are not obsolete.", "- {x}"),
    ("Obsolete memory entries approved for retirement.", "Approved:\n- {y}\n- {x} (unsure, left alone)"),
    ("Note", "{x} is obsolete."),
    ("Note", "{x} is no longer true."),
    ("Note", "Retire {x} - obsolete"),
])
def test_prose_drafts_nothing(store, manage, abstract, body):
    x, y = slugs(store, "x-entry", "y-entry", kind="decision")
    write(store, "fact", "note", abstract.format(x=x, y=y), body.format(x=x, y=y))
    assert declared(manage) == set()


# Shaped like the 2026-11-26 owner declaration: a cued abstract, per-type bullet lists of slugs, an unsure line.
LIVE_NAME = "battuta-event-2026-11-26-47-obsolete-memory-entries-approved-for-retirement"
LIVE_ABSTRACT = ("2026-11-26: Owner approved retiring 47 obsolete Battuta memory entries (the audit's 46 plus FIS-178 Langfuse "
                 "commitment) through the next dream; 17 unsure entries left alone.")
LIVE_LISTS = {
    "Commitments (15)": (
        "battuta-commitment-fis-157-manager-self-delivery", "battuta-commitment-fis-158-model-selection-investigation",
        "battuta-commitment-fis-160-voice-delivery-runtime-check", "battuta-commitment-fis-170-recall-status-wording",
        "battuta-commitment-fis-179-check-before-closing", "battuta-commitment-fis-179-draft-pr-opened",
        "battuta-commitment-fis-180-worktree-location-research", "battuta-commitment-fis-182-brief-delegation-draft-pr",
        "battuta-commitment-fis-187-restart-test-and-root-cause-report", "battuta-commitment-fis-187-ticket-and-pr-report",
        "battuta-commitment-fis-193-design-and-pr", "battuta-commitment-fis-194-pr-110-report-delivered-2026-11-22",
        "battuta-commitment-fis-194-reclaim-path-confirmation-and-pr-body-edit",
        "battuta-commitment-fis-178-langfuse-prompt-scope (plus FIS-170 and FIS-179 as listed in the audit)"),
    "Decisions": ("battuta-decision-fis-193-kept-open-as-design-task", "battuta-decision-worktree-location-stays-until-fis-180"),
    "Entities": ("battuta-entity-battuta-manager", "battuta-entity-pi-harness-delegate"),
    "Experiences (13)": ("artifact-built-as-plain-html", "dream-same-slot-cached-error"),
    "Procedure": ("battuta-procedure-debug-nightly-memory-dream-failure",),
}
LIVE_UNSURE = "battuta-decision-bot-prompt-storage-in-langfuse"
LIVE_BODY = ("The owner said to tell the next dream they are superseded, with no per-entry confirmation needed.\n\n"
             "The 47 entries, by type:\n"
             + "".join(f"- {label}: {', '.join(names)}.\n" for label, names in LIVE_LISTS.items())
             + f"\nNot touched: the 17 unsure entries (including {LIVE_UNSURE}), and dated history events.\n")
LIVE_LISTED = [name.split(" ")[0] for names in LIVE_LISTS.values() for name in names if name.startswith("battuta-")]


def live_store(store, body):
    for name in (*LIVE_LISTED, LIVE_UNSURE):
        store.record(type=name.split("-")[1], name=name, fields={"project": "battuta", "subject": name},
                     abstract=f"Entry {name}", body=f"Entry {name}", valid_from="2026-11-01T00:00:00Z")
    store.record(type="event", name=LIVE_NAME, abstract=LIVE_ABSTRACT, body=body, valid_from="2026-11-26T22:11:32Z",
                 fields={"project": "battuta", "subject": "47-obsolete-memory-entries-approved-for-retirement",
                         "date": "2026-11-26"})


def test_26_nov_free_text_declaration_drafts_nothing(store, manage):
    # The 26 Nov declaration has no Retire lines, so the dream drafts nothing from it.
    # CoS retired its 47 entries through memory_forget on 28 Nov instead.
    live_store(store, LIVE_BODY)
    assert declared(manage) == set()


def test_live_shaped_retire_lines_draft_exactly_the_listed_slugs(store, manage):
    chosen = LIVE_LISTED[:3]
    live_store(store, LIVE_BODY + "\n" + "".join(f"- Retire: {name} - closed in the 26 Nov audit\n" for name in chosen))
    drafted = {name: proposal for name, proposal in deletes(manage.proposals()).items() if isinstance(proposal, DeclaredProposal)}
    assert set(drafted) == set(chosen)
    assert {proposal.reason for proposal in drafted.values()} == {"closed in the 26 Nov audit"}
    assert {proposal.evidence for proposal in drafted.values()} == {f"declared by {LIVE_NAME}"}


@pytest.mark.parametrize("kind", ["event", "commitment", "experience"])
def test_old_never_recalled_entry_without_declaration_is_not_drafted(store, manage, kind):
    record = write(store, kind, "old", f"Old {kind} entry", days=60)
    assert not [proposal for proposal in manage.proposals(records=store.records(), hits={})
                if record.name in proposal.targets and isinstance(proposal, DeclaredProposal)]
    assert record.name not in deletes(manage.proposals(records=store.records(), hits={record.name: 1}))


def test_ledger_detail_carries_reason_and_evidence(store, manage):
    target = write(store, "fact", "old-plan", "The old plan", days=5)
    write(store, "fact", "plan-change", "Plan change", retire(target.name, reason="the plan changed"))
    proposal = deletes(manage.proposals())[target.name]
    decision = manage.decide(proposal.id, accept=True)
    expected = f"marked {target.name} invalid - the plan changed [declared by battuta-fact-plan-change]"
    assert decision.detail == expected
    ledger = (store.layout.dream_reports / "decisions.md").read_text(encoding="utf-8")
    assert f"- {proposal.id} accepted {decision.at} — {expected}\n" in ledger


def test_supersede_detail_carries_reason_on_one_line(store, manage):
    keeper = write(store, "fact", "keeper", "Keeper entry with the longer body", "A much longer body that wins the keeper choice.")
    loser = write(store, "fact", "loser", "Loser entry", "Short.")
    supersede = Proposal(reasoning.PROPOSAL_SUPERSEDE, (keeper.name, loser.name), "same\nfact", "near\n duplicate")
    assert manage._supersede(supersede, {}) == f"kept {keeper.name} - same fact [near duplicate]"


def test_retire_line_reason_is_one_line(store, manage):
    target = write(store, "fact", "old-office", "Old office", days=5)
    write(store, "fact", "office-move", "Office move", f"Retire: {target.name} - per the owner\t  no longer   valid\n\nNext line.")
    proposal = deletes(manage.proposals())[target.name]
    assert proposal.reason == "per the owner no longer valid"
    decision = manage.decide(proposal.id, accept=True)
    assert "\n" not in decision.detail
    assert "per the owner no longer valid" in decision.detail


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
    write(store, "fact", "retro-note", "Retro note", retire(target.name, reason="retro is done"))
    proposal = deletes(manage.proposals())[target.name]
    report = manage.sleep(accepting([proposal.id]))
    text = Path(report.path).read_text(encoding="utf-8")
    assert f"- delete {target.name} — retro is done [declared by battuta-fact-retro-note] (proposal {proposal.id}, decided " in text


def test_retired_file_is_retained_with_invalid_at(store, manage):
    target = write(store, "event", "offsite", "Offsite happened", days=60)
    write(store, "fact", "offsite-note", "Offsite note", retire(target.name))
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
    (Manage, "_usage", "(self) -> 'tuple[dict[str, int], dict[str, int], dict[str, str]]'"),
    (Manage, "_ledger", "(self) -> 'DecisionLedger'"),
    (Manage, "_entry", "(self, name: 'str') -> 'MemoryRecord'"),
    (Manage, "_merge", "(self, proposal: 'Proposal', verdict: 'reasoning.Verdict', expected: 'dict[str, str]') -> 'str'"),
    (Manage, "_merge_exact_duplicates", "(self, records: 'list[MemoryRecord]') -> 'list[Action]'"),
    (Manage, "_add_cooccurrence_links", "(self, records: 'list[MemoryRecord]') -> 'list[Action]'"),
    (Manage, "_propose_deletions", "(self, records: 'list[MemoryRecord]', hits: 'dict[str, int]') -> 'list[Proposal]'"),
    (Manage, "_propose_merges", "(self, records: 'list[MemoryRecord]') -> 'list[Proposal]'"),
    (Manage, "_propose_splits", "(self, records: 'list[MemoryRecord]') -> 'list[Proposal]'"),
    (Manage, "_propose_abstract_review", "(self, records: 'list[MemoryRecord]') -> 'list[Proposal]'"),
    (Store, "find", "(self, name: 'str') -> 'MemoryRecord | None'"),
    (Store, "merge", "(self, names: 'list[str]', abstract: 'str', body: 'str', name: 'str | None' = None, *, "
                     "expected_source_hashes: 'dict[str, str] | None' = None) -> 'MemoryRecord'"),
    (Store, "merge_exact_duplicate", "(self, duplicate: 'MemoryRecord', keeper: 'MemoryRecord', at: 'str') -> 'MemoryRecord | None'"),
    (Store, "supersede", "(self, old: 'str', new: 'str', *, expected_source_hash: 'str | None' = None, "
                         "expected_successor_hash: 'str | None' = None) -> 'MemoryRecord'"),
])
def test_private_core_hook_signatures_unchanged(owner, name, signature):
    assert str(inspect.signature(getattr(owner, name))) == signature


@pytest.mark.parametrize(("owner", "fields"), [
    (Proposal, ("kind", "targets", "reason", "evidence")),
    (DreamReport, ("at", "actions", "proposals", "inspected", "path", "decisions", "withheld", "committed", "dream_id", "review")),
    (Decision, ("proposal_id", "verdict", "at", "detail")),
    (Action, ("kind", "target", "detail")),
])
def test_core_dataclass_fields_unchanged(owner, fields):
    assert tuple(field.name for field in dataclasses.fields(owner)) == fields


def test_manage_keeps_the_attributes_battuta_reads(manage):
    for attribute in ("_clock", "_config", "_store"):
        assert hasattr(manage, attribute)


def accept_all(manage):
    return accepting([proposal.id for proposal in manage.proposals()])


def floor_entry(store, manage, kind, subject):
    record = write(store, kind, subject, f"Quiet {kind} {subject}", days=90)
    record.weight = manage._config.weight.floor
    manage._rewrite(record)
    return store.find(record.name)


@pytest.mark.parametrize("kind", ["preference", "decision"])
def test_undeclared_protected_entry_at_weight_floor_is_kept(store, manage, kind):
    record = floor_entry(store, manage, kind, "quiet")
    assert record.name not in deletes(manage.proposals(records=store.records(), hits={}))
    manage.sleep(accept_all(manage))
    assert record.name in {entry.name for entry in store.records()}


def test_core_weight_floor_delete_still_applies_to_facts(store, manage):
    record = floor_entry(store, manage, "fact", "quiet")
    assert deletes(manage.proposals(records=store.records(), hits={}))[record.name].evidence.startswith("weight=")


def pair(store, kind, keeper_days, other_days):
    keeper = write(store, kind, "keeper", f"Keeper {kind}", "A much longer body that wins the keeper choice.", days=keeper_days)
    other = write(store, kind, "other", f"Other {kind}", "Short.", days=other_days)
    return keeper, other


@pytest.mark.parametrize(("kind", "keeper_days", "other_days", "kept"), [
    (reasoning.PROPOSAL_MERGE, 1, 10, False),
    (reasoning.PROPOSAL_SUPERSEDE, 10, 1, False),
    (reasoning.PROPOSAL_SUPERSEDE, 5, 5, False),
    (reasoning.PROPOSAL_SUPERSEDE, 1, 10, True),
])
def test_core_merge_and_supersede_of_preferences(store, manage, kind, keeper_days, other_days, kept):
    keeper, other = pair(store, "preference", keeper_days, other_days)
    proposal = Proposal(kind, (keeper.name, other.name), "abstracts overlap", "similarity=0.9")
    with mock.patch.object(Manage, "proposals", return_value=[proposal]):
        assert (proposal.id in {drafted.id for drafted in manage.proposals()}) is kept


# P2: through sleep(), an older keeper is dropped and a newer keeper stands.
@pytest.mark.parametrize(("keeper_days", "other_days", "applied"), [(1, 10, True), (10, 1, False)])
def test_sleep_supersedes_preference_only_with_newer_keeper(store, manage, keeper_days, other_days, applied):
    keeper, other = pair(store, "preference", keeper_days, other_days)
    proposal = Proposal(reasoning.PROPOSAL_SUPERSEDE, (keeper.name, other.name), "abstracts overlap", "similarity=0.9")
    with mock.patch.object(Manage, "proposals", return_value=[proposal]):
        report = manage.sleep(accepting([proposal.id]))
    active = {record.name for record in store.records()}
    assert keeper.name in active
    assert (other.name not in active) is applied
    assert (proposal.id in {decision.proposal_id for decision in report.decisions}) is applied


def test_declared_delete_wins_over_core_draft_for_the_same_target(store, manage):
    target = floor_entry(store, manage, "fact", "quiet")
    write(store, "fact", "note", "Note", retire(target.name))
    drafted = [proposal for proposal in manage.proposals(records=store.records(), hits={})
               if target.name in proposal.targets and proposal.kind == reasoning.PROPOSAL_DELETE]
    assert len(drafted) == 1
    assert isinstance(drafted[0], DeclaredProposal)


@pytest.mark.parametrize(("kind", "merged"), [("preference", False), ("fact", True)])
def test_exact_duplicates(store, manage, kind, merged):
    first = write(store, kind, "same", "Same entry", days=5)
    second = store.record(type=kind, name=f"{first.name}-again", fields=dict(first.fields), abstract=first.abstract,
                          body=first.body, valid_from=first.valid_from)
    report = manage.sleep(lambda _prompt: "")
    active = {record.name for record in store.records()}
    assert ({first.name, second.name} <= active) is not merged
    section = Path(report.path).read_text(encoding="utf-8").split("## retired\n\n", 1)[1]
    duplicates = [action for action in report.actions if action.kind == ACTION_DUPLICATE_MERGED]
    assert bool(duplicates) is merged
    for action in duplicates:
        assert f"- {ACTION_DUPLICATE_MERGED} {action.target} — exact duplicate of {action.detail}" in section


def test_rejected_declaration_does_not_block_a_later_one(store, manage):
    (x,) = slugs(store, "x-entry", days=10)
    write(store, "fact", "first-note", "First note", retire(x), days=3)
    rejected = deletes(manage.proposals())[x]
    manage.decide(rejected.id, accept=False)
    assert x not in deletes(manage.proposals())
    write(store, "fact", "second-note", "Second note", retire(x, reason="stale now"))
    drafted = deletes(manage.proposals())[x]
    assert drafted.evidence == "declared by battuta-fact-second-note"
    assert rejected.evidence == "declared by battuta-fact-first-note"
    assert rejected.id not in {proposal.id for proposal in manage.proposals()}


def test_already_inactive_target_is_a_no_change(store, manage):
    x, successor = slugs(store, "x-entry", "x-successor")
    write(store, "fact", "note", "Note", retire(x))
    proposal = deletes(manage.proposals())[x]
    opened = manage._open

    def supersede_first(proposal_id):
        found = opened(proposal_id)
        store.supersede(x, successor)  # X is retired between drafting and the decision, and stays on disk.
        return found

    with mock.patch.object(manage, "_open", side_effect=supersede_first):
        decision = manage.decide(proposal.id, accept=True)
    assert decision.detail == f"no change: {x} already inactive"
    assert f"marked {x} invalid" not in (store.layout.dream_reports / "decisions.md").read_text(encoding="utf-8")
    report = DreamReport(at=decision.at, actions=(), proposals=(), inspected=0, decisions=(decision,))
    section = Path(manage._write_report(report)).read_text(encoding="utf-8").split("## retired\n\n", 1)[1]
    assert x not in section


def test_accepted_merge_is_listed_with_its_reason(store, manage):
    keeper, other = pair(store, "fact", 5, 5)
    proposal = Proposal(reasoning.PROPOSAL_MERGE, (keeper.name, other.name), "abstracts overlap", "similarity=0.9")
    with mock.patch.object(Manage, "proposals", return_value=[proposal]):
        verdict = reasoning.Verdict(proposal.id, True, abstract="Merged fact", body="Merged body.")
        decision = manage.decide(proposal.id, accept=True, verdict=verdict)
    assert decision.detail.endswith(" - abstracts overlap [similarity=0.9]")
    report = DreamReport(at=decision.at, actions=(), proposals=(), inspected=0, decisions=(decision,))
    section = Path(manage._write_report(report)).read_text(encoding="utf-8").split("## retired\n\n", 1)[1]
    assert section.startswith(f"- merge {keeper.name}, {other.name} — abstracts overlap [similarity=0.9] (proposal {proposal.id}")


# S6: a merge whose source went inactive is a no change, directly and through sleep().
def test_merge_with_already_inactive_source_is_a_no_change(store, manage):
    keeper, other = pair(store, "fact", 5, 5)
    (successor,) = slugs(store, "successor")
    proposal = Proposal(reasoning.PROPOSAL_MERGE, (keeper.name, other.name), "abstracts overlap", "similarity=0.9")
    store.supersede(other.name, successor)
    verdict = reasoning.Verdict(proposal.id, True, abstract="Merged fact", body="Merged body.")
    assert manage._merge(proposal, verdict, {}) == f"no change: {other.name} already inactive"


def test_sleep_merge_with_source_retired_first_writes_no_misleading_line(store, manage):
    keeper, other = pair(store, "fact", 5, 5)
    (successor,) = slugs(store, "successor")
    proposal = Proposal(reasoning.PROPOSAL_MERGE, (keeper.name, other.name), "abstracts overlap", "similarity=0.9")
    opened = manage._open

    def supersede_first(proposal_id):
        found = opened(proposal_id)
        store.supersede(keeper.name, successor)
        return found

    with mock.patch.object(Manage, "proposals", return_value=[proposal]), \
            mock.patch.object(manage, "_open", side_effect=supersede_first):
        report = manage.sleep(accepting([proposal.id]))
    # Core's reviewed-source check rejects the inactive keeper before _merge runs, so sleep() withholds it.
    assert report.decisions == ()
    assert report.withheld == (proposal.id,)
    section = Path(report.path).read_text(encoding="utf-8").split("## retired\n\n", 1)[1]
    assert "marked " not in section
    assert f"- merge {keeper.name}" not in section
    assert other.name in {record.name for record in store.records()}


@pytest.mark.parametrize("bad", [None, "not-a-date"])
def test_newer_is_false_for_missing_or_malformed_dates(bad):
    good = SimpleNamespace(valid_from="2026-11-01T00:00:00Z", created="2026-11-01T00:00:00Z")
    broken = SimpleNamespace(valid_from=bad, created=bad)
    assert _newer(broken, good) is False
    assert _newer(good, broken) is False
