"""Recoverable derived graphs; never gives upstream analysis storage authority."""
import asyncio
import hashlib
import json

from pydantic import Field
from .contracts import Contract, EvidenceRef


class GraphEdge(Contract):
    source_ref: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_ref: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    similarity: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    relationship_type: str = Field(pattern=r"^[a-z_]{1,40}$")
    needs_review: bool = Field(strict=True)


class GraphCluster(Contract):
    member_refs: list[str] = Field(min_length=2, max_length=500)


def normalized_results(derived, records):
    revisions = {r["ref"]: r["revision"] for r in records}
    edges = {}
    for value in derived["edges"]:
        edge = GraphEdge.model_validate(value).model_dump()
        if (edge["source_ref"] == edge["target_ref"] or
            revisions.get(edge["source_ref"]) != edge["source_revision"] or
            revisions.get(edge["target_ref"]) != edge["target_revision"]):
            raise ValueError("Graph endpoint changed or outside snapshot")
        key = (edge["source_ref"], edge["target_ref"], edge["relationship_type"])
        if key not in edges or edge["similarity"] > edges[key]["similarity"]:
            edges[key] = edge
    clusters = set()
    for value in derived["clusters"]:
        members = tuple(sorted(set(GraphCluster.model_validate(value).member_refs)))
        if len(members) < 2 or not set(members) <= revisions.keys():
            raise ValueError("Graph cluster outside snapshot")
        clusters.add(members)
    return {"clusters": [{"member_refs": list(m)} for m in sorted(clusters)],
        "edges": sorted(edges.values(), key=lambda e: (-e["similarity"], e["source_ref"], e["target_ref"], e["relationship_type"]))}


class GlobalConsolidation:
    def __init__(self, adapter, state, mutations, recover):
        self.adapter = adapter
        self.state = state
        self.mutations = mutations
        self.recover = recover
        self.builder = asyncio.Lock()

    @staticmethod
    def matches(generation, snapshot):
        return generation is not None and all(generation[k] == snapshot[k]
            for k in ("input_fingerprint", "algorithm_fingerprint"))

    async def snapshot(self):
        if self.state is None:
            raise RuntimeError("Graph state unavailable")
        await self.recover()
        return await self.adapter.global_snapshot()

    @staticmethod
    def receipt(generation):
        return {**{k: generation[k] for k in ("generation_id", "input_fingerprint", "algorithm_fingerprint", "input_count")},
            "cluster_count": len(generation["clusters"]), "edge_count": len(generation["edges"]), "status": "published"}

    async def consolidate(self, run_id):
        async with self.builder:
            for _ in range(2):
                async with self.mutations:
                    snapshot = await self.snapshot()
                    active = self.state.graph_active()
                    if self.matches(active, snapshot):
                        self.state.discard_graph_draft()
                        return self.receipt(active)
                    draft = self.state.graph_draft(snapshot["input_fingerprint"], snapshot["algorithm_fingerprint"])
                if draft is None:
                    derived = normalized_results(await self.adapter.analyze_global(snapshot), snapshot["records"])
                    identity = [snapshot["input_fingerprint"], snapshot["algorithm_fingerprint"]]
                    draft = {**derived, "generation_id": hashlib.sha256(json.dumps(identity).encode()).hexdigest(),
                        "input_fingerprint": identity[0], "algorithm_fingerprint": identity[1], "run_id": run_id,
                        "input_count": len(snapshot["records"]),
                        "inputs": [EvidenceRef(ref=r["ref"], revision=r["revision"]).model_dump() for r in snapshot["records"]]}
                    self.state.save_graph_draft(draft)
                async with self.mutations:
                    if not self.matches(draft, await self.snapshot()):
                        self.state.discard_graph_draft()
                        continue
                    return self.receipt(self.state.activate_graph(draft["generation_id"]))
            raise RuntimeError("Global memory changed during consolidation; retry later")

    async def relationships(self):
        async with self.mutations:
            if self.state is None:
                raise RuntimeError("Graph state unavailable")
            active = self.state.graph_active()
            response = {"status": "unavailable", "generation_id": None, "input_fingerprint": None,
                "algorithm_fingerprint": None, "edges": [], "truncated": False}
            if active is None:
                return response
            response.update({k: active[k] for k in ("generation_id", "input_fingerprint", "algorithm_fingerprint")})
            if not self.matches(active, await self.snapshot()):
                return {**response, "status": "stale"}
            return {**response, "status": "current", "edges": active["edges"][:100], "truncated": len(active["edges"]) > 100}
