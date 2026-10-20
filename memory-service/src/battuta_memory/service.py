import asyncio
import hashlib
import json
import uuid
from .scope import resolve_selector, resolve_scope, registered
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

    @staticmethod
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

    async def _apply(self, key, payload):
        try:
            await getattr(self.adapter, payload["operation"])(payload)
            result = payload["result"]
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
        digest = self.digest(request.model_dump(mode="json", by_alias=True))
        async with self.mutations:
            await self._recover()
            prior = self.state.receipt(key, digest)
            if prior is not None:
                result = prior
            else:
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
                operation = "metadata"
                outcome = "linked" if projects != existing else "reused"
            return {"operation": operation, "ref": ref, "content": request.content, "tags": tags, "kind": request.kind,
                "sources": sources, "result": {"ref": ref, "outcome": outcome}}
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
            await asyncio.to_thread(self.adapter.embed, request.content)
            ref = self.adapter.content_ref(request.content)
            if await self.adapter.get(ref, include_deleted=True):
                raise ValueError("Version content already exists; explicit conflict resolution required")
            scope_tags = ["scope:global"] if current["scope"]["global"] else [f"proj:{p}" for p in current["scope"]["projects"]]
            kind = request.kind or current["kind"]
            return {"operation": "evolve", "ref": ref, "old_ref": request.ref, "content": request.content,
                "tags": scope_tags + (request.tags if request.tags is not None else current["tags"]) + [f"kind:{kind}"],
                "kind": kind, "reason": request.reason, "result": {"ref": ref, "predecessor_ref": request.ref}}
        return await self._mutation("update:" + self.digest(request.model_dump()), request, plan)

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
            await self._active(request.ref)
            return {"operation": "delete", "ref": request.ref, "result": {"ref": request.ref, "forgotten": True, "retention": "Tombstone retains content; not secure erasure"}}
        return await self._mutation("forget:" + request.ref, request, plan)
