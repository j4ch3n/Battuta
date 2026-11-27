from unittest import mock

from agent_memory.core.search_index import to_match_query

import battuta_memory.store  # noqa: F401  (installs the stopword filter)
from battuta_memory import query_terms


def test_keyword_query_goes_through_the_stopword_filter():
    with mock.patch.object(query_terms, "STOPWORDS", frozenset({"the"})):
        assert to_match_query("the mornings", "cjk") == '"mornings"'
        assert to_match_query("the", "cjk") == '"the"'
