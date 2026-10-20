import asyncio
import hashlib
import json
import uuid
from .scope import resolve_selector, resolve_scope, registered
from .contracts import UpdateRequest
from .upstream import TerminalMutationError


class MemoryService:
    def __init__(self, adapter, config, state=None):
        self.adapter = adapter
        self.config = config
        self.state = state
        self.mutations = asyncio.Lock()

    async def recall(self, request):
        selected = resolve_selector(request, self.config.registry_root)
        records = await self.adapter.search(request, selected)
        return {"records": records, "incomplete": False, "warnings": selected.warnings}

    async def list(self, request):
        selected = resolve_selector(request, self.config.registry_root)
        records = await self.adapter.list(request, selected)
        offset = (request.page - 1) * request.page_size
        return {"records": records[offset:offset + request.page_size], "total": len(records), "warnings": selected.warnings}

    async def get(self, request):
        record = await self.adapter.get(request.ref)
        if not record:
            raise ValueError("Memory not found")
        if not request.include_history and not record["active"]:
            raise ValueError("Memory is inactive; request history explicitly")
        if request.include_history:
            record["history"] = await self.adapter.history(request.ref)
        return record

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
        # Preserve pre-extension receipt keys/digests when optional guards and
        # extra update citations were not supplied.
        if not value.get("evidence"):
            value.pop("evidence", None)
        if isinstance(request, UpdateRequest) and not value.get("sources"):
            value.pop("sources", None)
        for field in ("expected_revision", "replacement_ref"):
            if value.get(field) is None:
                value.pop(field, None)
        return value

    async def _apply(self, key, payload):
        try:
            await getattr(self.adapter, payload["operation"])(payload)
            result = dict(payload["result"])
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
            sources = [s.model_dump() for s in request.sources]
            outcome = "created"
            operation = "store"
            if current:
                if not current["active"]:
                    raise ValueError("Inactive history conflict")
                if current["scope"]["global"] != request.scope.global_:
                    raise ValueError("Global/project scope conflict")
                existing = current["scope"]["projects"]
                projects = sorted(set(existing + request.scope.projects))
                tags = (["scope:global"] if request.scope.global_ else [f"proj:{p}" for p in projects]) + sorted(set(current["tags"] + request.tags)) + [f"kind:{current['kind']}"]
                sources = list({self.digest(s): s for s in current["sources"] + sources}.values())
                if len(sources) > 200:
                    raise ValueError("Too many source citations")
                operation = "metadata"
                outcome = "linked" if projects != existing else "reused"
            return {"operation": operation, "ref": ref, "content": request.content, "tags": tags, "kind": request.kind,
                "sources": sources, "result": {"ref": ref, "outcome": outcome, "before": current["content"] if current else None}}
        return await self._mutation("remember:" + (request.idempotency_key or uuid.uuid4().hex), request, plan)

    async def _active(self, ref):
        record = await self.adapter.get(ref, include_deleted=True)
        if not record:
            raise ValueError("Memory not found")
        if not record["active"]:
            raise ValueError("Memory is inactive")
        return record

    async def update(self, request):
        async def plan():
            current = await self._active(request.ref)
            if request.expected_revision is not None and current["revision"] != request.expected_revision:
                raise ValueError("Memory changed since inventory")
            await asyncio.to_thread(self.adapter.embed, request.content)
            ref = self.adapter.content_ref(request.content)
            if await self.adapter.get(ref, include_deleted=True):
                raise ValueError("Version content already exists; explicit conflict resolution required")
            scope_tags = ["scope:global"] if current["scope"]["global"] else [f"proj:{p}" for p in current["scope"]["projects"]]
            kind = request.kind or current["kind"]
            sources = list({self.digest(s): s for s in current["sources"] + [s.model_dump() for s in request.sources]}.values())
            if len(sources) > 200:
                raise ValueError("Too many source citations")
            return {"operation": "evolve", "ref": ref, "old_ref": request.ref, "content": request.content,
                "tags": scope_tags + (request.tags if request.tags is not None else current["tags"]) + [f"kind:{kind}"],
                "kind": kind, "reason": request.reason, "sources": sources,
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
