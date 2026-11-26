from pathlib import Path

from agent_memory.core.config import Config

from .embedder import load_embedder
from .store import BattutaStore


def battuta_store_factory(root, agent="battuta"):
    vectors = Config.load(Path(root)).index.vector_enabled
    return BattutaStore(root, agent=agent, embedder=load_embedder(Path.home()) if vectors else None)
