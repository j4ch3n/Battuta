"""The only storage/embedding dependency boundary; no upstream schema changes."""

import asyncio
import fcntl
import hashlib
import json
import math
from importlib.metadata import version
from pathlib import Path

from .config import DIMENSION, MODEL, MemoryConfig


class UpstreamAdapter:
    def __init__(self, storage, lock=None, manifest=None):
        self.storage = storage
        self._lock = lock
        self.manifest = manifest

    @staticmethod
    def verify_cache(home: Path):
        folder = home / ".cache/mcp_memory/onnx_models" / MODEL / "onnx"
        try:
            manifest = json.loads((folder / "battuta-manifest.json").read_text())
            if manifest["model"] != MODEL or manifest["dimension"] != DIMENSION:
                raise ValueError("Wrong model identity")
            for name in ("model.onnx", "tokenizer.json"):
                with (folder / name).open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                if digest != manifest["files"][name]:
                    raise ValueError("Model checksum mismatch")
            return manifest
        except (OSError, ValueError, KeyError) as error:
            raise RuntimeError("Verified ONNX model unavailable; run battuta-memory model install") from error

    @staticmethod
    def create_storage(config):
        from mcp_memory_service.storage.sqlite_vec import SqliteVecMemoryStorage
        return SqliteVecMemoryStorage(str(config.database), embedding_model=MODEL)

    @classmethod
    async def open(cls, config: MemoryConfig):
        config.configure_upstream()
        manifest = cls.verify_cache(Path.home())
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock = (config.data_dir / "service.lock").open("a+")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            lock.close()
            raise RuntimeError("Another memory server owns this data directory") from error
        adapter = None
        try:
            storage = cls.create_storage(config)
            adapter = cls(storage, lock, manifest)
            await storage.initialize()
            await adapter.assert_real_embeddings()
            return adapter
        except BaseException:
            if adapter:
                await adapter.close()
            else:
                lock.close()
            raise

    async def assert_real_embeddings(self):
        storage = self.storage
        if storage.embedding_model_name != MODEL or storage.embedding_dimension != DIMENSION:
            raise RuntimeError("Embedding model identity mismatch; explicit migration required")
        from mcp_memory_service.embeddings.onnx_embeddings import ONNXEmbeddingModel
        model = storage.embedding_model
        if not isinstance(model, ONNXEmbeddingModel) or model._tokenizer is None or model._model is None:
            raise RuntimeError("Actual ONNX model and tokenizer required; hash fallback refused")
        if model.model_name != MODEL or model._model.get_providers() != ["CPUExecutionProvider"]:
            raise RuntimeError("Unexpected ONNX model/provider")
        vector = await asyncio.to_thread(model.encode, ["Embedding readiness check"])
        values = list(vector[0])
        if len(values) != DIMENSION or not all(math.isfinite(float(x)) for x in values) or not any(values):
            raise RuntimeError("Invalid ONNX probe vector")
        return self.manifest

    async def health(self):
        await self.assert_real_embeddings()
        return {"ready": True, "model": self.manifest, "upstream_version": version("mcp-memory-service")}

    async def close(self):
        try:
            await self.storage.close()
        finally:
            if self._lock:
                self._lock.close()
                self._lock = None
