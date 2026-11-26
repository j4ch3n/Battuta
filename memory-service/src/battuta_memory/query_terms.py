"""Keyword-side query terms without stopwords; vector search still embeds the whole query."""
import stopwordsiso
from agent_memory.core import search_index, tokenization

STOPWORDS = frozenset(stopwordsiso.stopwords(["en", "zh"]))


def query_terms(query: str, tokenizer: str) -> list[str]:
    tokens = tokenization.query_tokens(query, tokenizer)
    # A query of only stopwords keeps them, so the keyword side still has something to match.
    return [token for token in tokens if token not in STOPWORDS] or tokens


# shortcut: patches the pinned agent-memory's keyword query builder; move upstream into query_tokens when it gains stopwords.
search_index.query_tokens = query_terms
