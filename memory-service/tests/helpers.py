import hashlib
from pathlib import Path

from battuta_memory.layout import initialize_store
from battuta_memory.store import BattutaStore, write_catalog


class HashEmbedder:
    """Deterministic stand-in for the ONNX model: shared words give similar vectors."""

    def _vector(self, text):
        vector = [0.0] * 32
        for word in text.lower().split():
            vector[hashlib.sha256(word.encode()).digest()[0] % 32] += 1.0
        norm = sum(value * value for value in vector) ** 0.5 or 1.0
        return [value / norm for value in vector]

    def embed_documents(self, texts):
        return [self._vector(text) for text in texts]

    def embed_query(self, text):
        return self._vector(text)


def make_store(directory, projects=("battuta", "mocktest"), distill_view=False) -> BattutaStore:
    root = Path(directory).resolve() / "store"
    initialize_store(root)
    write_catalog(root, list(projects))
    store = BattutaStore(root, embedder=HashEmbedder(), distill_view=distill_view)
    store.init()
    return store


def entity(project, subject, abstract, body="", **extra):
    return {"type": "entity", "fields": {"project": project, "subject": subject}, "abstract": abstract, "body": body, **extra}
