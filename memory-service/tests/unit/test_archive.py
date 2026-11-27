import json

import pytest
from agent_memory.core import sessions
from agent_memory.core.watermark import Watermark
from battuta_memory.archive import ingest


def line(entry_id, timestamp, speaker="owner", text="hello"):
    return json.dumps({"entry_id": entry_id, "conversation_id": "c1", "speaker": speaker, "text": text, "timestamp": timestamp})


def body(*lines):
    return ("\n".join(lines) + "\n").encode()


def test_routes_by_own_offset_and_dedupes(store):
    first = [line("a", "2026-11-25T23:30:00+08:00"), line("b", "2026-11-26T00:10:00+08:00", "cos", "noted")]
    result = ingest(store, body(*first))
    assert result["days"] == {"cos-2026-11-25": {"received": 1, "appended": 1, "duplicates": 0},
                              "cos-2026-11-26": {"received": 1, "appended": 1, "duplicates": 0}}
    again = ingest(store, body(*first, line("c", "2026-11-26T09:00:00+08:00")))
    assert again["days"]["cos-2026-11-26"] == {"received": 2, "appended": 1, "duplicates": 1}
    messages = sessions.read(store.layout, "cos-2026-11-26")
    assert [(m.index, m.role, m.text) for m in messages] == [(0, "assistant", "noted"), (1, "user", "hello")]


@pytest.mark.parametrize("bad", [
    "{not json",
    line("x", "2026-11-26T09:00:00"),
    line("x", "2026-11-26T09:00:00Z", speaker="manager"),
    line("x", "2026-11-26T09:00:00Z", text=" "),
], ids=["not-json", "naive-timestamp", "unknown-speaker", "blank-text"])
def test_rejects_whole_upload_on_malformed_line(store, bad):
    with pytest.raises(ValueError):
        ingest(store, body(line("ok", "2026-11-24T09:00:00Z"), bad))
    assert not sessions.session_path(store.layout, "cos-2026-11-24").exists()


def test_watermark_backlog_counts_new_lines(store):
    ingest(store, body(line("a", "2026-11-26T09:00:00Z"), line("b", "2026-11-26T09:01:00Z")))
    mark = Watermark(store.layout).read("cos-2026-11-26")
    assert (mark.consumed, mark.backlog()) == (2, 2)
