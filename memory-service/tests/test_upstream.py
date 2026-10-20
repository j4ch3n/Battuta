import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from battuta_memory.config import MemoryConfig
from battuta_memory.upstream import UpstreamAdapter


class UpstreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_database_rejects_hash_fallback(self):
        storage = SimpleNamespace(embedding_model=object(), embedding_model_name="all-MiniLM-L6-v2", embedding_dimension=384)
        with self.assertRaisesRegex(RuntimeError, "ONNX"):
            await UpstreamAdapter(storage).assert_real_embeddings()

    async def test_wrong_same_width_model_rejected(self):
        storage = SimpleNamespace(embedding_model=object(), embedding_model_name="other-384", embedding_dimension=384)
        with self.assertRaisesRegex(RuntimeError, "model"):
            await UpstreamAdapter(storage).assert_real_embeddings()

    async def test_missing_tokenizer_fails_readiness(self):
        with tempfile.TemporaryDirectory() as home:
            with self.assertRaisesRegex(RuntimeError, "model install"):
                UpstreamAdapter.verify_cache(Path(home))

    async def test_adapter_closes_after_failed_initialization(self):
        storage = SimpleNamespace(initialize=AsyncMock(side_effect=RuntimeError("initialization failed")), close=AsyncMock())
        with tempfile.TemporaryDirectory() as data:
            config = MemoryConfig(data_dir=Path(data))
            with patch.object(UpstreamAdapter, "verify_cache", return_value={}), patch.object(UpstreamAdapter, "create_storage", return_value=storage):
                with self.assertRaisesRegex(RuntimeError, "initialization failed"):
                    await UpstreamAdapter.open(config)
                storage.close.assert_awaited_once()
                # Failure must release the writer lock for a subsequent retry.
                with self.assertRaisesRegex(RuntimeError, "initialization failed"):
                    await UpstreamAdapter.open(config)
