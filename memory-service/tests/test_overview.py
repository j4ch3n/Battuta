import unittest

from battuta_memory.overview import _parse


class OverviewReplyTests(unittest.TestCase):
    def test_parses_imperfect_model_json(self):
        replies = {
            "fenced with prose": 'Here it is:\n```json\n{"abstract": "Banking prototype", "body": "Client Acme"}\n```',
            "trailing comma": '{"abstract": "Banking prototype", "body": "Client Acme",}',
            "single quotes": "{'abstract': 'Banking prototype', 'body': 'Client Acme'}",
        }
        for name, reply in replies.items():
            with self.subTest(name):
                self.assertEqual(_parse(reply), ("Banking prototype", "Client Acme"))

    def test_rejects_reply_without_both_parts(self):
        for reply in ("no json here", '{"abstract": "only a line"}', "[1, 2]"):
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                _parse(reply)


if __name__ == "__main__":
    unittest.main()
