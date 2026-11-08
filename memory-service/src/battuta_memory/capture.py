import hashlib
import json
from .contracts import RememberRequest, UpdateRequest


class CaptureService:
    def __init__(self, service):
        self.service = service

    @staticmethod
    def digest(batch):
        value = batch.model_dump(mode="json", by_alias=True, exclude={"payload_digest"})
        for item in value["items"]:
            projects = item.pop("projects")
            item["scope"] = {"global": projects == ["global"], "projects": [] if projects == ["global"] else projects}
            if item.get("memory_metadata") is None:
                item.pop("memory_metadata", None)
            if item.get("correction") is None:
                item.pop("correction", None)
            for source in item["sources"]:
                if source.get("attribution") is None:
                    source.pop("attribution", None)
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

    async def ingest(self, batch):
        if self.digest(batch) != batch.payload_digest:
            raise ValueError("Capture payload digest mismatch")
        state = self.service.state
        key = self.service.digest([batch.agent_id, batch.session_id, batch.batch_id])
        result = state.capture_receipt(key, batch.payload_digest)
        if result is not None:
            return result
        results = []
        for item in batch.items:
            request = RememberRequest.model_validate(item.model_dump(by_alias=True, exclude={"item_id", "idempotency_key", "correction"}) | {
                "idempotency_key": "capture:" + self.service.digest([key, item.item_id])})
            try:
                if item.correction:
                    receipt = await self.service.update(UpdateRequest(ref=item.correction.ref, expected_revision=item.correction.revision,
                        content=item.content, reason="Attributed conversation correction", sources=item.sources, memory_metadata=item.memory_metadata),
                        expected_scope=item.scope.model_dump(by_alias=True))
                else:
                    receipt = await self.service.remember(request)
                results.append({"item_id": item.item_id, "status": "completed", **receipt})
            except Exception as error:
                results.append({"item_id": item.item_id, "status": "failed", "error": "Capture item could not be stored",
                    "code": "embedding_limit" if isinstance(error, ValueError) and str(error).startswith("Memory exceeds embedding token limit") else "capture_failed"})
        result = {"batch_id": batch.batch_id, "complete": all(r["status"] == "completed" for r in results), "items": results}
        if result["complete"]:
            state.complete_capture(key, result)
        return result
