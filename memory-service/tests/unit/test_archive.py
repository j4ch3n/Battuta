import json
import unittest

from agent_memory.core import sessions
from agent_memory.core.watermark import Watermark
from battuta_memory.archive import ingest
from helpers import make_store


def line(entry_id, timestamp, speaker="owner", text="hello"):
    return json.dumps({"entry_id": entry_id, "conversation_id": "c1", "speaker": speaker, "text": text, "timestamp": timestamp})


def body(*lines):
    return ("\n".join(lines) + "\n").encode()


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store(self)

    def test_routes_by_own_offset_and_dedupes(self):
        first = [line("a", "2026-11-25T23:30:00+08:00"), line("b", "2026-11-26T00:10:00+08:00", "cos", "noted")]
        result = ingest(self.store, body(*first))
        self.assertEqual(result["days"], {"cos-2026-11-25": {"received": 1, "appended": 1, "duplicates": 0},
                                          "cos-2026-11-26": {"received": 1, "appended": 1, "duplicates": 0}})
        again = ingest(self.store, body(*first, line("c", "2026-11-26T09:00:00+08:00")))
        self.assertEqual(again["days"]["cos-2026-11-26"], {"received": 2, "appended": 1, "duplicates": 1})
        messages = sessions.read(self.store.layout, "cos-2026-11-26")
        self.assertEqual([(m.index, m.role, m.text) for m in messages], [(0, "assistant", "noted"), (1, "user", "hello")])

    def test_rejects_whole_upload_on_malformed_line(self):
        for bad in ("{not json", line("x", "2026-11-26T09:00:00"), line("x", "2026-11-26T09:00:00Z", speaker="manager"),
                    line("x", "2026-11-26T09:00:00Z", text=" ")):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                ingest(self.store, body(line("ok", "2026-11-24T09:00:00Z"), bad))
        self.assertFalse(sessions.session_path(self.store.layout, "cos-2026-11-24").exists())

    def test_watermark_backlog_counts_new_lines(self):
        ingest(self.store, body(line("a", "2026-11-26T09:00:00Z"), line("b", "2026-11-26T09:01:00Z")))
        mark = Watermark(self.store.layout).read("cos-2026-11-26")
        self.assertEqual((mark.consumed, mark.backlog()), (2, 2))


if __name__ == "__main__":
    unittest.main()
