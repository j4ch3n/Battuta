"""Append extracted Owner and CoS messages to one append-only session file per local day."""
import datetime as dt
import json

from agent_memory.core.locking import store_lock
from agent_memory.core.sessions import count, session_path
from agent_memory.core.watermark import Watermark

ROLES = {"owner": "user", "cos": "assistant"}
REQUIRED = ("entry_id", "conversation_id", "speaker", "text", "timestamp")
MAX_TEXT = 100_000


def day_key(timestamp: str) -> str:
    return "cos-" + dt.datetime.fromisoformat(timestamp).date().isoformat()


def _parse(number: int, raw: bytes) -> dict:
    try:
        line = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError(f"line {number}: not JSON") from error
    if not isinstance(line, dict) or any(not isinstance(line.get(name), str) or not line[name].strip() for name in REQUIRED):
        raise ValueError(f"line {number}: requires non-empty {', '.join(REQUIRED)}")
    if line["speaker"] not in ROLES:
        raise ValueError(f"line {number}: speaker must be owner or cos")
    if len(line["text"]) > MAX_TEXT:
        raise ValueError(f"line {number}: text too long")
    try:
        if dt.datetime.fromisoformat(line["timestamp"]).utcoffset() is None:
            raise ValueError
    except ValueError as error:
        raise ValueError(f"line {number}: timestamp must be ISO 8601 with an offset") from error
    return {name: line[name] for name in REQUIRED}


def _existing_ids(path) -> set[str]:
    if not path.exists():
        return set()
    return {json.loads(line).get("entry_id") for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def ingest(store, body: bytes) -> dict:
    """Validate every line first, so a bad upload never half-writes a day file."""
    lines = [_parse(number, raw) for number, raw in enumerate(body.splitlines(), 1) if raw.strip()]
    by_day: dict[str, list[dict]] = {}
    for line in sorted(lines, key=lambda item: dt.datetime.fromisoformat(item["timestamp"])):
        by_day.setdefault(day_key(line["timestamp"]), []).append(line)
    watermark = Watermark(store.layout, store.clock)
    days = {}
    with store_lock(store.layout):
        for key, items in sorted(by_day.items()):
            path = session_path(store.layout, key)
            path.parent.mkdir(parents=True, exist_ok=True)
            seen = _existing_ids(path)
            index = count(path)
            fresh = []
            for item in items:
                if item["entry_id"] in seen:
                    continue
                seen.add(item["entry_id"])
                fresh.append(json.dumps({"index": index, "role": ROLES[item["speaker"]], "text": item["text"], "at": item["timestamp"],
                    "entry_id": item["entry_id"], "conversation_id": item["conversation_id"], "speaker": item["speaker"]}, ensure_ascii=False))
                index += 1
            if fresh:
                with path.open("a", encoding="utf-8") as handle:
                    handle.write("\n".join(fresh) + "\n")
                watermark.advance(key, index, source="battuta-archive")
            days[key] = {"received": len(items), "appended": len(fresh), "duplicates": len(items) - len(fresh)}
    return {"days": days}
