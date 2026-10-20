import asyncio
from .scope import resolve_selector


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
