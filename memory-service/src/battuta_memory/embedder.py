"""In-process Qwen3-Embedding: last-token pooling, L2-normalised, instructed queries."""
from pathlib import Path

import numpy as np

QUERY_INSTRUCTION = "Instruct: Given a question, retrieve memories that answer it\nQuery: "
MAX_TOKENS = 512
END_OF_TEXT = "<|endoftext|>"


class QwenEmbedder:
    def __init__(self, model_dir: Path, session=None, tokenizer=None):
        if session is None:
            import onnxruntime
            session = onnxruntime.InferenceSession(str(model_dir / "onnx/model_int8.onnx"), providers=["CPUExecutionProvider"])
        if tokenizer is None:
            from tokenizers import Tokenizer
            tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self._session = session
        self._tokenizer = tokenizer
        self._inputs = {item.name for item in session.get_inputs()}
        # The decoder export takes a KV cache; an empty one runs a plain forward pass.
        self._cache = [(item.name, item.shape) for item in session.get_inputs() if item.name.startswith("past_key_values")]
        self._end = tokenizer.token_to_id(END_OF_TEXT)

    def embed_documents(self, texts):
        return [self._embed(text) for text in texts]

    def embed_query(self, text):
        return self._embed(QUERY_INSTRUCTION + text)

    def _embed(self, text):
        # One sequence per run: this export does not mask padding exactly, so batching skews vectors.
        ids = list(self._tokenizer.encode(text).ids)[:MAX_TOKENS]
        if self._end is not None and ids[-1:] != [self._end]:
            ids = ids[: MAX_TOKENS - 1] + [self._end]
        input_ids = np.array([ids], dtype=np.int64)
        feeds = {"input_ids": input_ids, "attention_mask": np.ones_like(input_ids)}
        if "position_ids" in self._inputs:
            feeds["position_ids"] = np.arange(len(ids), dtype=np.int64)[None, :]
        for name, shape in self._cache:
            feeds[name] = np.zeros((1, shape[1], 0, shape[3]), dtype=np.float32)
        hidden = self._session.run(None, {name: value for name, value in feeds.items() if name in self._inputs})[0]
        pooled = hidden[0, -1, :].astype(np.float64)
        norm = float(np.linalg.norm(pooled)) or 1.0
        return (pooled / norm).tolist()


def load_embedder(home: Path) -> QwenEmbedder:
    from .model_setup import model_folder, verify_model
    verify_model(home)
    return QwenEmbedder(model_folder(home))
