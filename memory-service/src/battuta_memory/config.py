import os
from dataclasses import dataclass, field
from pathlib import Path

MODEL = "all-MiniLM-L6-v2"
DIMENSION = 384


@dataclass(frozen=True)
class MemoryConfig:
    data_dir: Path = field(default_factory=lambda: Path.home() / ".battuta/memory-service")
    registry_root: Path = field(default_factory=lambda: Path.home() / ".battuta/projects")
    host: str = "127.0.0.1"
    port: int = 8901

    def __post_init__(self):
        if self.host not in ("127.0.0.1", "::1", "localhost"):
            raise ValueError("Only loopback hosts are supported")
        if not self.data_dir.is_absolute() or not self.registry_root.is_absolute():
            raise ValueError("Memory and registry paths must be absolute")
        if not 1 <= self.port <= 65535:
            raise ValueError("Invalid port")

    @property
    def database(self):
        return self.data_dir / "memory.db"

    @classmethod
    def from_env(cls):
        return cls(
            data_dir=Path(os.environ.get("BATTUTA_MEMORY_DATA_DIR", "~/.battuta/memory-service")).expanduser(),
            registry_root=Path(os.environ.get("BATTUTA_PROJECTS_ROOT", "~/.battuta/projects")).expanduser(),
            host=os.environ.get("BATTUTA_MEMORY_HOST", "127.0.0.1"),
            port=int(os.environ.get("BATTUTA_MEMORY_PORT", "8901")),
        )

    def configure_upstream(self):
        # Upstream reads many settings at import time. Deliberately override unsafe defaults.
        os.environ.update({
            "MCP_MEMORY_STORAGE_BACKEND": "sqlite_vec",
            "MCP_MEMORY_SQLITE_PATH": str(self.database),
            "MCP_MEMORY_USE_ONNX": "true",
            "MCP_MEMORY_ONNX_PROVIDERS": "CPUExecutionProvider",
            "MCP_EMBEDDING_MODEL": MODEL,
            "MCP_MEMORY_ONNX_ALLOW_DOWNLOAD": "false",
            "MCP_MEMORY_ALLOW_HASH_EMBEDDINGS": "false",
            "MCP_SEMANTIC_DEDUP_ENABLED": "false",
            "MCP_CONTRADICTION_DETECTION_ENABLED": "false",
            "MCP_CONTRADICTION_ON_STORE": "false",
            "MCP_CONSOLIDATION_AUTO_SUPERSEDE": "false",
            "MCP_BOOTSTRAP_ENABLED": "false",
            "MCP_CONSOLIDATION_ENABLED": "false",
        })
        for key in ("MCP_EXTERNAL_EMBEDDING_URL", "MCP_EXTERNAL_EMBEDDING_API_KEY", "MCP_ONNX_MODEL_REPO"):
            os.environ.pop(key, None)
