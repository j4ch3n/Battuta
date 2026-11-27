"""CoS-only forget: end a memory's validity interval (keep the file) and audit it in the decisions ledger."""

import json

from agent_memory.core.errors import MemoryStoreError
from agent_memory.core.ledger import VERDICT_ACCEPTED, Decision, DecisionLedger

from .dream import DreamState

MAX_FORGET = 25


def _text(value) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _validate(store, arguments: dict) -> tuple[list[dict], str, str]:
    entries = arguments.get("entries")
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_FORGET:
        raise ValueError(f"entries must be a list of 1 to {MAX_FORGET} items")
    plan = []
    for index, item in enumerate(entries):
        if not isinstance(item, dict) or set(item) - {"slug", "successor"} or _text(item.get("slug")) is None \
                or ("successor" in item and _text(item["successor"]) is None):
            raise ValueError(f"entries[{index}] must be {{slug, successor?}} with non-empty strings")
        plan.append({"slug": _text(item["slug"]), "successor": _text(item.get("successor"))})
    reason, confirmation = _text(arguments.get("reason")), _text(arguments.get("owner_confirmation"))
    if reason is None:
        raise ValueError("reason is required")
    if confirmation is None:
        raise ValueError("owner_confirmation is required")
    slugs = [entry["slug"] for entry in plan]
    if len(set(slugs)) != len(slugs):
        raise ValueError("duplicate slugs: " + ", ".join(sorted({slug for slug in slugs if slugs.count(slug) > 1})))
    for entry in plan:
        if entry["successor"] == entry["slug"]:
            raise ValueError(f"{entry['slug']} cannot succeed itself")
        if entry["successor"] in slugs:
            raise ValueError(f"successor {entry['successor']} is also being forgotten in this call")
    if DreamState(store.root).running():
        raise ValueError("a memory dream is running; retry after it finishes")
    for entry in plan:
        entry["record"] = store.find(entry["slug"])
    unknown = [entry["slug"] for entry in plan if entry["record"] is None]
    if unknown:
        raise ValueError("unknown slugs: " + ", ".join(unknown))
    for entry in plan:
        if entry["successor"] is not None:
            successor = store.find(entry["successor"])
            if successor is None or not successor.is_active():
                raise ValueError(f"successor {entry['successor']} is missing or no longer valid")
            entry["successor_hash"] = successor.source_hash
    return plan, reason, confirmation


def forget(store, arguments: dict) -> dict:
    plan, reason, confirmation = _validate(store, arguments)
    ledger, results, applied = DecisionLedger(store.layout), [], []
    for entry in plan:
        record, slug, successor = entry["record"], entry["slug"], entry["successor"]
        if not record.is_active():
            results.append({"slug": slug, "result": "no-op", "invalid_at": record.invalid_at})
            continue
        try:
            if successor is not None:
                after = store.supersede(slug, successor, expected_source_hash=record.source_hash,
                                        expected_successor_hash=entry["successor_hash"])
                action = "superseded"
            else:
                after = store.delete(slug, expected_source_hash=record.source_hash)
                action = "forgotten"
            detail = {"action": action, "invalid_at": after.invalid_at, "successor": successor, "reason": reason,
                      "owner_confirmation": confirmation, "by": "cos"}
            ledger.append(Decision(f"forget:{slug}", VERDICT_ACCEPTED, store.clock.now().isoformat(),
                                   json.dumps(detail, ensure_ascii=False)))
        except MemoryStoreError as error:
            raise ValueError(f"forget stopped at {slug} ({type(error).__name__}); already applied: {', '.join(applied) or 'none'}") from error
        applied.append(slug)
        result = {"slug": slug, "result": action, "invalid_at": after.invalid_at}
        if successor is not None:
            result["successor"] = successor
        results.append(result)
    return {"results": results}
