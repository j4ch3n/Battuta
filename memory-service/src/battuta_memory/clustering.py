"""Pure cosine-similarity grouping over stored, normalised embeddings."""

import numpy as np

from .config import DIMENSION

STEP = 0.05


def _components(sim, threshold):
    n = len(sim)
    seen, parts = [False] * n, []
    for start in range(n):
        if seen[start]:
            continue
        seen[start], stack, part = True, [start], []
        while stack:
            i = stack.pop()
            part.append(i)
            for j in np.nonzero(sim[i] >= threshold)[0]:
                if not seen[j]:
                    seen[j] = True
                    stack.append(int(j))
        parts.append(sorted(part))
    return parts


def cluster(vectors, threshold, max_size):
    """Return (clusters of row indexes with 2+ members, raised threshold steps)."""
    if len(vectors) < 2:
        return [], []
    sim = vectors @ vectors.T
    clusters, raised, pending = [], [], [(p, threshold) for p in _components(sim, threshold)]
    while pending:
        part, level = pending.pop()
        if len(part) > max_size:
            nxt = round(level + STEP, 4)
            if nxt >= 1:
                raise ValueError("Cluster cannot be split below the size limit")
            raised.append({"from": level, "to": nxt})
            sub = sim[np.ix_(part, part)]
            pending.extend(([part[i] for i in piece], nxt) for piece in _components(sub, nxt))
        elif len(part) > 1:
            clusters.append(part)
    return clusters, raised


def cluster_projects(groups, threshold, max_size):
    """groups: {project: [(ref, embedding blob)]} in created order -> per-project cluster report."""
    report = []
    for project in sorted(groups):
        items = groups[project]
        vectors = np.array([np.frombuffer(blob, dtype="<f4", count=DIMENSION) for _, blob in items], dtype=np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors = vectors / np.where(norms == 0, 1, norms)
        parts, raised = cluster(vectors, threshold, max_size)
        parts.sort(key=lambda p: p[0])
        report.append({"project": project, "clusters": [[items[i][0] for i in p] for p in parts],
            "singletons": len(items) - sum(len(p) for p in parts),
            "largest": max((len(p) for p in parts), default=0), "raised": raised})
    return report
