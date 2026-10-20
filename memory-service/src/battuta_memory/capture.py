import hashlib
import json
from .contracts import RememberRequest


class CaptureService:
    def __init__(self, service):
        self.service = service

    @staticmethod
    def digest(batch):
        value = batch.model_dump(mode="json", by_alias=True, exclude={"payload_digest"})
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
            request = RememberRequest.model_validate(item.model_dump(by_alias=True, exclude={"item_id", "idempotency_key"}) | {
                "idempotency_key": "capture:" + self.service.digest([key, item.item_id])})
            try:
                receipt = await self.service.remember(request)
                results.append({"item_id": item.item_id, "status": "completed", **receipt})
            except Exception as error:
                results.append({"item_id": item.item_id, "status": "failed", "error": "Capture item could not be stored",
                    "code": "embedding_limit" if isinstance(error, ValueError) and str(error).startswith("Memory exceeds embedding token limit") else "capture_failed"})
        result = {"batch_id": batch.batch_id, "complete": all(r["status"] == "completed" for r in results), "items": results}
        if result["complete"]:
            state.complete_capture(key, result)
        return result
