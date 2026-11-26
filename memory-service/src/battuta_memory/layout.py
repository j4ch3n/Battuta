"""Create the Battuta store: our config knobs and our memory types, never the library factory set."""
from importlib import resources
from pathlib import Path

from agent_memory.core.config import Config

CONVERSATION_TYPES = ("profile", "preference", "entity", "event", "decision", "procedure", "fact", "experience", "reference", "commitment")
OVERVIEW = "overview"
VECTOR_MODEL = "qwen3-embedding-0.6b-int8"


def store_config() -> Config:
    config = Config()
    config.storage.field_sources = {"project": "system", "date": "system"}
    config.storage.default_project = ""
    config.index.tokenizer = "cjk"
    config.index.vector_enabled = True
    config.index.vector_model = VECTOR_MODEL
    # The library ORs every query word, stopwords included; a lighter abstract boost lets vector matches compete.
    config.index.bm25_abstract_weight = 1.5
    config.recall.injection_enabled = False
    config.manage.auto_dream = False
    return config


def initialize_store(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    if not (root / "config.toml").exists():
        store_config().save(root)
    schemas = root / "schemas"
    schemas.mkdir(exist_ok=True)
    for name in (*CONVERSATION_TYPES, OVERVIEW):
        target = schemas / f"{name}.toml"
        if not target.exists():
            target.write_text((resources.files("battuta_memory") / "schemas" / f"{name}.toml").read_text(encoding="utf-8"), encoding="utf-8")
