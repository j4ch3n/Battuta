import os
from dataclasses import dataclass, field
from pathlib import Path

DREAM_MODEL = "claude-haiku-5-5"


@dataclass(frozen=True)
class MemoryConfig:
    data_dir: Path = field(default_factory=lambda: Path.home() / ".battuta/memory")
    host: str = "127.0.0.1"
    port: int = 8901
    dream_model: str = DREAM_MODEL

    def __post_init__(self):
        if self.host not in ("127.0.0.1", "::1", "localhost"):
            raise ValueError("Only loopback hosts are supported")
        if not self.data_dir.is_absolute():
            raise ValueError("Memory path must be absolute")
        if not 1 <= self.port <= 65535:
            raise ValueError("Invalid port")
        if not self.dream_model.strip() or any(char.isspace() for char in self.dream_model):
            raise ValueError("Invalid dream model")

    @property
    def store_dir(self) -> Path:
        return self.data_dir / "store"

    @classmethod
    def from_env(cls):
        return cls(
            data_dir=Path(os.environ.get("BATTUTA_MEMORY_DATA_DIR", "~/.battuta/memory")).expanduser(),
            host=os.environ.get("BATTUTA_MEMORY_HOST", "127.0.0.1"),
            port=int(os.environ.get("BATTUTA_MEMORY_PORT", "8901")),
            dream_model=os.environ.get("BATTUTA_MEMORY_DREAM_MODEL") or DREAM_MODEL,
        )
