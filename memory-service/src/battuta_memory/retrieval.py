"""Deterministic rank fusion and literal keyword queries."""

import re
import unicodedata


def fuse_ranks(semantic_refs, lexical_refs, limit):
    scores = {}
    for branch in (semantic_refs, lexical_refs):
        for rank, ref in enumerate(dict.fromkeys(branch), 1):
            scores[ref] = scores.get(ref, 0) + 1 / (60 + rank)
    return sorted(scores, key=lambda ref: (-scores[ref], ref))[:limit]


def lexical_query(terms):
    terms = list(dict.fromkeys(" ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", term).casefold())) for term in terms))
    terms = [term for term in terms if term]
    return " OR ".join('"' + term.replace('"', '""') + '"' for term in terms)
