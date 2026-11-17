"""Deterministic rank fusion and literal keyword queries."""

import re
import unicodedata


def interleave_ranks(rankings):
    # Rank-by-rank round robin: each query's top result first, then next ranks, no repeats.
    seen, merged = set(), []
    for rank in range(max((len(r) for r in rankings), default=0)):
        for ranking in rankings:
            if rank < len(ranking) and ranking[rank] not in seen:
                seen.add(ranking[rank])
                merged.append(ranking[rank])
    return merged


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
