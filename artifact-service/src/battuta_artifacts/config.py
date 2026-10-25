"""Configuration shared by the CLI and HTTP service."""

import os
from pathlib import Path


def database_path() -> Path:
    return Path(os.environ.get("BATTUTA_ARTIFACT_DB", "~/.battuta/artifacts/registry.sqlite3")).expanduser().absolute()


def public_base_url() -> str:
    value = os.environ.get("BATTUTA_ARTIFACT_BASE_URL", "").rstrip("/")
    if not value:
        raise ValueError("BATTUTA_ARTIFACT_BASE_URL is required")
    return value
