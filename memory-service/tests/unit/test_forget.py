import json
import os
from unittest import mock

import pytest
from agent_memory.core.ledger import DecisionLedger
from agent_memory.core.store import Store

from battuta_memory.dream import DreamState
from battuta_memory.forget import SOFT_MAX_FORGET, forget
from battuta_memory.reads import Reads
from helpers import entity

CONFIRM = {"reason": "Acme left the project", "owner_confirmation": "Owner said: forget Acme"}


def add(store, subject, abstract=None, project="mocktest"):
    return store.record(**entity(project, subject, abstract or f"{subject} is a contact for {project}")).name


def ledger_path(store):
    return store.layout.dream_reports / "decisions.md"


def snapshot(store):
    return {path: path.read_bytes() for path in store.layout.truth_files()}


def assert_rejected_without_writes(store, arguments, message=None):
    before = snapshot(store)
    with pytest.raises(ValueError) as caught:
        forget(store, arguments)
    if message:
        assert message in str(caught.value)
    assert snapshot(store) == before
    assert not ledger_path(store).exists()
    return caught.value


def call(store, entries, **extra):
    return forget(store, {"entries": entries, **CONFIRM, **extra})


@pytest.mark.parametrize("with_successor", [False, True], ids=["delete-forgets", "successor-supersedes"])
def test_forget_marks_status(store, with_successor):
    slug = add(store, "acme-ltd")
    successor = add(store, "acme-group") if with_successor else None
    entry = {"slug": slug, "successor": successor} if with_successor else {"slug": slug}
    result = call(store, [entry])["results"][0]
    record = store.find(slug)
    assert (result["slug"], result["result"]) == (slug, "superseded" if with_successor else "forgotten")
    assert record.invalid_at is not None
    assert result["invalid_at"] == record.invalid_at
    assert record.superseded_by == successor
    if with_successor:
        assert result["successor"] == successor
        assert store.find(successor).is_active()
    else:
        assert "successor" not in result


def test_batch_soft_cap(store):
    assert_rejected_without_writes(store, {"entries": [], **CONFIRM}, "non-empty")
    slugs = [add(store, f"contact-{index}") for index in range(SOFT_MAX_FORGET + 1)]
    within = call(store, [{"slug": slug} for slug in slugs[:SOFT_MAX_FORGET]])
    assert "warning" not in within
    assert str(SOFT_MAX_FORGET) in within["message"]
    over = call(store, [{"slug": slug} for slug in slugs])
    assert "warning" in over
    assert [result["result"] for result in over["results"]] == ["no-op"] * SOFT_MAX_FORGET + ["forgotten"]
    assert not store.find(slugs[-1]).is_active()


@pytest.mark.parametrize("key", ["reason", "owner_confirmation"])
@pytest.mark.parametrize("value", [None, "", "   ", 3], ids=["missing", "empty", "blank", "not-a-string"])
def test_reason_and_confirmation_required(store, key, value):
    slug = add(store, "acme-ltd")
    arguments = {"entries": [{"slug": slug}], **CONFIRM}
    if value is None:
        del arguments[key]
    else:
        arguments[key] = value
    assert_rejected_without_writes(store, arguments, key)


SLUG = "mocktest-entity-acme-ltd"


@pytest.mark.parametrize("entries", [
    "x",
    [SLUG],
    [{"slug": ""}],
    [{"slug": SLUG, "successor": " "}],
    [{"slug": SLUG, "extra": 1}],
    [{}],
], ids=["not-a-list", "bare-string-entry", "empty-slug", "blank-successor", "extra-key", "no-slug"])
def test_bad_entry_shapes_rejected(store, entries):
    assert add(store, "acme-ltd") == SLUG
    assert_rejected_without_writes(store, {"entries": entries, **CONFIRM})


def test_unknown_slug_rejects_whole_batch(store):
    first, second = add(store, "acme-ltd"), add(store, "beta-ltd")
    error = assert_rejected_without_writes(
        store, {"entries": [{"slug": first}, {"slug": "nope-one"}, {"slug": second}, {"slug": "nope-two"}], **CONFIRM})
    assert "nope-one" in str(error)
    assert "nope-two" in str(error)
    assert store.find(first).is_active()
    assert store.find(second).is_active()


def test_missing_or_inactive_successor_rejected(store):
    old, retired = add(store, "acme-ltd"), add(store, "acme-old")
    store.delete(retired)
    assert not ledger_path(store).exists()
    assert_rejected_without_writes(store, {"entries": [{"slug": old, "successor": "missing-slug"}], **CONFIRM}, "missing-slug")
    assert_rejected_without_writes(store, {"entries": [{"slug": old, "successor": retired}], **CONFIRM}, retired)
    assert store.find(old).is_active()


def test_already_invalid_is_noop(store):
    plain, superseded, successor = add(store, "acme-ltd"), add(store, "acme-old"), add(store, "acme-group")
    store.delete(plain)
    store.delete(superseded)
    invalid = {slug: store.find(slug).invalid_at for slug in (plain, superseded)}
    before = snapshot(store)
    results = call(store, [{"slug": plain}, {"slug": superseded, "successor": successor}])["results"]
    assert [(r["slug"], r["result"], r["invalid_at"]) for r in results] == [
        (plain, "no-op", invalid[plain]), (superseded, "no-op", invalid[superseded])]
    assert snapshot(store) == before
    assert not ledger_path(store).exists()


def test_file_is_kept(store):
    slug = add(store, "acme-ltd")
    path = store.find(slug).path
    call(store, [{"slug": slug}])
    assert path.exists()
    assert store.find(slug).invalid_at is not None
    assert slug in [record.name for record in store.records(include_invalid=True)]
    assert slug not in [record.name for record in store.records()]


def test_recall_hides_forgotten(store):
    slug, other = add(store, "acme-ltd", "Acme Ltd is the client"), add(store, "beta-ltd", "Beta Ltd is a supplier")
    reads = Reads(store)
    assert slug in [m["name"] for m in reads.recall(query="Acme client")["memories"]]
    call(store, [{"slug": slug}])
    assert slug not in [m["name"] for m in reads.recall(query="Acme client")["memories"]]
    names = [m["name"] for m in reads.recall(projects=["mocktest"])["memories"]]
    assert slug not in names
    assert other in names


def test_ledger_audit_line(store):
    slug, old, new = add(store, "acme-ltd"), add(store, "beta-old"), add(store, "beta-new")
    results = call(store, [{"slug": slug}, {"slug": old, "successor": new}])["results"]
    decided = DecisionLedger(store.layout).decided()
    assert set(decided) == {f"forget:{slug}", f"forget:{old}"}
    forgotten = json.loads(decided[f"forget:{slug}"].detail)
    assert decided[f"forget:{slug}"].verdict == "accepted"
    assert forgotten == {"action": "forgotten", "invalid_at": results[0]["invalid_at"], "successor": None,
                         "reason": CONFIRM["reason"], "owner_confirmation": CONFIRM["owner_confirmation"], "by": "cos"}
    superseded = json.loads(decided[f"forget:{old}"].detail)
    assert (superseded["action"], superseded["successor"], superseded["invalid_at"]) == ("superseded", new, results[1]["invalid_at"])


def test_ledger_detail_stays_one_line(store):
    slug = add(store, "acme-ltd")
    forget(store, {"entries": [{"slug": slug}], "reason": "line one\nline two — café", "owner_confirmation": "yes"})
    detail = json.loads(DecisionLedger(store.layout).decided()[f"forget:{slug}"].detail)
    assert detail["reason"] == "line one\nline two — café"
    assert "\nline two" not in ledger_path(store).read_text(encoding="utf-8")


def test_ledger_failure_reports_applied_with_missing_audit(store):
    slug, later = add(store, "acme-ltd"), add(store, "beta-ltd")
    path = store.find(slug).path
    with mock.patch.object(DecisionLedger, "append", side_effect=OSError("disk full")):
        reply = call(store, [{"slug": slug}, {"slug": later}])
    assert store.find(slug).invalid_at is not None
    assert path.exists()
    assert store.find(later).is_active()
    assert reply["applied"] == [slug]
    assert reply["audit_missing"] == [slug]
    assert reply["not_processed"] == [later]
    assert len(reply["results"]) == 1
    result = reply["results"][0]
    assert (result["slug"], result["result"], result["audit_missing"]) == (slug, "forgotten", True)
    assert slug in result["error"]
    assert "OSError" in result["error"]
    assert "audit record is MISSING" in reply["error"]
    assert not ledger_path(store).exists()


def test_gc_never_called(store):
    slug, old, new = add(store, "acme-ltd"), add(store, "beta-old"), add(store, "beta-new")
    with mock.patch.object(Store, "gc", side_effect=AssertionError("gc must not run")) as gc:
        call(store, [{"slug": slug}, {"slug": old, "successor": new}])
    gc.assert_not_called()


@pytest.mark.parametrize(("entries", "message"), [
    ([{"slug": "A"}, {"slug": "A"}], "duplicate"),
    ([{"slug": "A", "successor": "A"}], "itself"),
    ([{"slug": "A", "successor": "B"}, {"slug": "B"}], "also being forgotten"),
    ([{"slug": "C"}, {"slug": "A", "successor": "C"}], "also being forgotten"),
], ids=["duplicate-entry", "self-successor", "successor-forgotten-later", "successor-forgotten-earlier"])
def test_duplicate_self_and_in_batch_successor_rejected(store, entries, message):
    slugs = {"A": add(store, "acme-ltd"), "B": add(store, "beta-ltd"), "C": add(store, "gamma-ltd")}
    resolved = [{key: slugs.get(value, value) for key, value in entry.items()} for entry in entries]
    assert_rejected_without_writes(store, {"entries": resolved, **CONFIRM}, message)


def test_rejected_while_dream_running(store):
    slug = add(store, "acme-ltd")
    DreamState(store.root).start(os.getpid())
    assert_rejected_without_writes(store, {"entries": [{"slug": slug}], **CONFIRM}, "dream")
    DreamState(store.root).finish(True, report={})
    assert call(store, [{"slug": slug}])["results"][0]["result"] == "forgotten"
