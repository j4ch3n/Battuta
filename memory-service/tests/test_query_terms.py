import unittest
from unittest import mock

from agent_memory.core.search_index import to_match_query

import battuta_memory.store  # noqa: F401  (installs the stopword filter)
from battuta_memory import query_terms


class QueryTermsTests(unittest.TestCase):
    def test_keyword_query_goes_through_the_stopword_filter(self):
        with mock.patch.object(query_terms, "STOPWORDS", frozenset({"the"})):
            self.assertEqual(to_match_query("the mornings", "cjk"), '"mornings"')
            self.assertEqual(to_match_query("the", "cjk"), '"the"')


if __name__ == "__main__":
    unittest.main()
