import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone
from .scope import resolve_selector, resolve_scope, registered
from .contracts import UpdateRequest, ListRequest
from .records import eligible_records
from .retrieval import fuse_ranks
from .rendering import render_memories, evidence_closure
from .upstream import TerminalMutationError
from .consolidation import GlobalConsolidation


class MemoryService:
    def __init__(self, adapter, config, state=None):
        self.adapter = adapter
        self.config = config
        self.state = state
        self.mutations = asyncio.Lock()
        self.consolidation = GlobalConsolidation(adapter, state, self.mutations, self._recover)

    async def consolidate_global(self, request):
        return await self.consolidation.consolidate(request.run_id)

    async def global_relationships(self, request):
        return await self.consolidation.relationships()

    async def recall(self, request):
        selected = resolve_selector(request, self.config.registry_root)
        async with self.mutations:
            if self.state is not None:
                await self._recover()
            records = await self.adapter.list(request.model_copy(update={"kind": None, "tags": [], "include_history": False}), selected)
            eligible = eligible_records(records, datetime.now(timezone.utc), request.include_expired)
            eligible = [r for r in eligible if (not request.kind or r["kind"] == request.kind) and
                (not request.tags or (all(t in r["tags"] for t in request.tags) if request.tag_match == "all" else any(t in r["tags"] for t in request.tags)))]
            branches, semantic, lexical = {}, [], []
            if request.semantic_query:
                try:
                    semantic = await self.adapter.search(request.model_copy(update={"limit": min(request.limit, 20)}), selected, [r["ref"] for r in eligible])
                    branches["semantic"] = "ready"
                except ValueError:
                    raise
                except Exception:
                    branches["semantic"] = "unavailable"
            if request.keywords:
                try:
                    if self.state is None:
                        raise RuntimeError("Keyword index unavailable")
                    await self._reconcile_index()
                    lexical = self.state.lexical_search(request.keywords, eligible, min(request.limit, 20))
                    branches["lexical"] = "ready"
                except Exception:
                    branches["lexical"] = "unavailable"
            if not any(value == "ready" for value in branches.values()):
                raise RuntimeError("Memory retrieval unavailable")
            lookup = {r["ref"]: r for r in eligible}
            refs = fuse_ranks([r["ref"] for r in semantic], lexical, request.limit)
            seeds = [lookup[ref] for ref in refs if ref in lookup]
            evidence = evidence_closure(seeds, records)
            view = render_memories(seeds, evidence, datetime.now(timezone.utc))
            incomplete = "unavailable" in branches.values() or view["incomplete"]
            return {**view, "records": seeds, "validation_evidence": evidence,
                "incomplete": incomplete, "branches": branches,
                "warnings": selected.warnings + (["Memory retrieval is partial"] if incomplete else [])}

    async def _reconcile_index(self):
        request = ListRequest(selector="all")
        records = await self.adapter.list(request, resolve_selector(request, self.config.registry_root))
        self.state.reconcile_index(records)

    async def list(self, request):
        selected = resolve_selector(request, self.config.registry_root)
        records = await self.adapter.list(request, selected)
        if not request.include_history:
            records = [r for r in records if r["active"]]
        offset = (request.page - 1) * request.page_size
        return {"records": records[offset:offset + request.page_size], "total": len(records), "warnings": selected.warnings}

    async def get(self, request):
        async with self.mutations:
            return await self._get(request)

    async def _get(self, request):
        record = await self.adapter.get(request.ref)
        if not record:
            raise ValueError("Memory not found")
        if not request.include_history and not record["active"]:
            raise ValueError("Memory is inactive; request history explicitly")
        if request.include_history:
            record["history"] = await self.adapter.history(request.ref)
        all_request = ListRequest(selector="all")
        records = await self.adapter.list(all_request, resolve_selector(all_request, self.config.registry_root))
        evidence = evidence_closure([record], records)
        view = render_memories([record], evidence, datetime.now(timezone.utc))
        return {**record, **view, "validation_evidence": evidence}

    async def inventory(self, request):
        # Includes every scope explicitly; no selected-project fallback. Mutations
        # and pending recovery cannot interleave with the inventory read.
        async with self.mutations:
            if self.state is not None:
                await self._recover()
            return await self.adapter.inventory(request)

    @staticmethod
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

    @staticmethod
    def request_value(request, by_alias=True):
        value = request.model_dump(mode="json", by_alias=by_alias)
        for source in value.get("sources", []):
            if source.get("attribution") is None:
                source.pop("attribution", None)
        # Preserve pre-extension receipt keys/digests when optional guards and
        # extra update citations were not supplied.
        if not value.get("evidence"):
            value.pop("evidence", None)
        if isinstance(request, UpdateRequest) and not value.get("sources"):
            value.pop("sources", None)
        for field in ("expected_revision", "replacement_ref", "memory_metadata"):
            if value.get(field) is None:
                value.pop(field, None)
        return value

    async def _apply(self, key, payload):
        try:
            await getattr(self.adapter, payload["operation"])(payload)
            result = dict(payload["result"])
            await self._reconcile_index()
            if "before" in result:
                record = await self.adapter.get(payload["ref"], include_deleted=True)
                result.update(after=record["content"] if record and record["active"] else None,
                    revision=record["revision"] if record else None)
        except TerminalMutationError as error:
            result = {"error": str(error)}
        self.state.complete_intent(key, result)
        return result

    async def _recover(self):
        for intent in self.state.recover_intents():
            await self._apply(intent["key"], intent["payload"])

    async def recover(self):
        async with self.mutations:
            await self._recover()
            await self._reconcile_index()

    async def _mutation(self, key, request, planner):
        digest = self.digest(self.request_value(request))
        async with self.mutations:
            await self._recover()
            prior = self.state.receipt(key, digest)
            if prior is not None:
                result = prior
            else:
                for evidence in getattr(request, "evidence", []):
                    source = await self.adapter.get(evidence.ref, include_deleted=True)
                    if not source or not source["active"] or source["revision"] != evidence.revision:
                        raise ValueError("Memory evidence changed since inventory")
                payload = await planner()
                self.state.prepare_intent(key, digest, payload)
                result = await self._apply(key, payload)
            if "error" in result:
                raise ValueError(result["error"])
            return result

    async def remember(self, request):
        async def plan():
            tags = resolve_scope(request.scope, self.config.registry_root) + request.tags + [f"kind:{request.kind}"]
            await asyncio.to_thread(self.adapter.embed, request.content)
            ref = self.adapter.content_ref(request.content)
            current = await self.adapter.get(ref, include_deleted=True)
            sources = [s.wire() for s in request.sources]
            metadata = request.memory_metadata.model_dump(mode="json") if request.memory_metadata is not None else None
            await self._validate_metadata(ref, metadata, request.scope.model_dump(by_alias=True), sources)
            outcome = "created"
            operation = "store"
            if current:
                if not current["active"]:
                    raise ValueError("Inactive history conflict")
                if current["scope"] != request.scope.model_dump(by_alias=True):
                    raise ValueError("Duplicate scope conflict")
                if current["sources"] != sources or current.get("memory_metadata") != metadata:
                    raise ValueError("Duplicate attribution or metadata conflict")
                existing = current["scope"]["projects"]
                projects = sorted(set(existing + request.scope.projects))
                tags = (["scope:global"] if request.scope.global_ else [f"proj:{p}" for p in projects]) + sorted(set(current["tags"] + request.tags)) + [f"kind:{current['kind']}"]
                sources = list({self.digest(s): s for s in current["sources"] + sources}.values())
                if len(sources) > 200:
                    raise ValueError("Too many source citations")
                operation = "metadata"
                outcome = "linked" if projects != existing else "reused"
            return {"operation": operation, "ref": ref, "content": request.content, "tags": tags, "kind": request.kind,
                "sources": sources, **({"memory_metadata": metadata} if metadata is not None else {}), "result": {"ref": ref, "outcome": outcome, "before": current["content"] if current else None}}
        return await self._mutation("remember:" + (request.idempotency_key or uuid.uuid4().hex), request, plan)

    async def _active(self, ref):
        record = await self.adapter.get(ref, include_deleted=True)
        if not record:
            raise ValueError("Memory not found")
        if not record["active"]:
            raise ValueError("Memory is inactive")
        return record

    async def _validate_metadata(self, ref, metadata, scope, sources):
        if metadata is None:
            return
        if not sources:
            raise ValueError("Memory needs attributed sources")
        seen = set()
        async def visit(target, path):
            if target in path:
                raise ValueError("Cyclic memory evidence")
            if target in seen:
                return
            record = await self._active(target)
            if record["scope"] != scope:
                raise ValueError("Evidence scope conflict")
            for link in (record.get("memory_metadata") or {}).get("evidence", []):
                await visit(link["ref"], path | {target})
            seen.add(target)
        for link in metadata["evidence"]:
            await visit(link["ref"], {ref})
            record = await self._active(link["ref"])
            if record["revision"] != link["revision"]:
                raise ValueError("Memory evidence changed")

    async def set_metadata(self, request):
        async def plan():
            current = await self._active(request.ref)
            if current["revision"] != request.expected_revision:
                raise ValueError("Memory changed since inventory")
            metadata = request.memory_metadata.model_dump(mode="json")
            prior = current.get("memory_metadata")
            withdrawal = prior is not None and metadata["status"] in {"stale", "superseded", "rejected"} and metadata == {**prior, "status": metadata["status"]}
            if not withdrawal:
                await self._validate_metadata(request.ref, metadata, current["scope"], current["sources"])
            replacement = None
            if request.replacement_ref is not None:
                replacement = await self._active(request.replacement_ref)
                if request.replacement_ref == request.ref or replacement["scope"] != current["scope"] or metadata["status"] != "superseded":
                    raise ValueError("Invalid lifecycle replacement")
            tags = (["scope:global"] if current["scope"]["global"] else [f"proj:{p}" for p in current["scope"]["projects"]]) + current["tags"] + [f"kind:{current['kind']}"]
            return {"operation": "metadata", "ref": request.ref, "tags": tags, "sources": current["sources"], "memory_metadata": metadata,
                **({"replacement_ref": request.replacement_ref} if replacement else {}),
                "result": {"ref": request.ref, "before": current["content"]}}
        return await self._mutation("metadata:" + request.idempotency_key, request, plan)

    async def update(self, request, expected_scope=None):
        async def plan():
            current = await self._active(request.ref)
            if expected_scope is not None and current["scope"] != expected_scope:
                raise ValueError("Correction scope conflict")
            if request.expected_revision is not None and current["revision"] != request.expected_revision:
                raise ValueError("Memory changed since inventory")
            await asyncio.to_thread(self.adapter.embed, request.content)
            ref = self.adapter.content_ref(request.content)
            if await self.adapter.get(ref, include_deleted=True):
                raise ValueError("Version content already exists; explicit conflict resolution required")
            scope_tags = ["scope:global"] if current["scope"]["global"] else [f"proj:{p}" for p in current["scope"]["projects"]]
            kind = request.kind or current["kind"]
            sources = list({self.digest(s): s for s in current["sources"] + [s.wire() for s in request.sources]}.values())
            if len(sources) > 200:
                raise ValueError("Too many source citations")
            metadata = request.memory_metadata.model_dump(mode="json") if request.memory_metadata is not None else current.get("memory_metadata")
            await self._validate_metadata(ref, metadata, current["scope"], sources)
            return {"operation": "evolve", "ref": ref, "old_ref": request.ref, "content": request.content,
                "tags": scope_tags + (request.tags if request.tags is not None else current["tags"]) + [f"kind:{kind}"],
                "kind": kind, "reason": request.reason, "sources": sources, **({"memory_metadata": metadata} if metadata is not None else {}),
                "result": {"ref": ref, "predecessor_ref": request.ref, "before": current["content"]}}
        return await self._mutation("update:" + self.digest(self.request_value(request, by_alias=False)), request, plan)

    async def link_projects(self, request):
        async def plan():
            current = await self._active(request.ref)
            if current["scope"]["global"]:
                raise ValueError("Cannot link global memory to projects")
            for name in request.add + request.remove:
                registered(name, self.config.registry_root)
            names = sorted((set(current["scope"]["projects"]) | set(request.add)) - set(request.remove))
            if not names:
                raise ValueError("Cannot remove final project")
            return {"operation": "metadata", "ref": request.ref, "tags": [f"proj:{p}" for p in names] + current["tags"] + [f"kind:{current['kind']}"],
                "sources": current["sources"], "result": {"ref": request.ref, "projects": names}}
        return await self._mutation("link:" + uuid.uuid4().hex, request, plan)

    async def forget(self, request):
        if request.dry_run:
            record = await self._active(request.ref)
            return {"ref": request.ref, "dry_run": True, "scope": record["scope"], "retention": "Tombstone retains content; not secure erasure"}
        async def plan():
            current = await self._active(request.ref)
            if request.expected_revision is not None and current["revision"] != request.expected_revision:
                raise ValueError("Memory changed since inventory")
            if request.replacement_ref is not None:
                replacement = await self._active(request.replacement_ref)
                if request.replacement_ref == request.ref or replacement["scope"] != current["scope"]:
                    raise ValueError("Merge replacement must be distinct and have identical scope")
            return {"operation": "delete", "ref": request.ref, "replacement_ref": request.replacement_ref,
                "result": {"ref": request.ref, "forgotten": True, "before": current["content"], "retention": "Tombstone retains content; not secure erasure"}}
        return await self._mutation("forget:" + request.ref, request, plan)
