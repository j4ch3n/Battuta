"""Configuration shared by the CLI and HTTP service."""

import os
from pathlib import Path


def database_path() -> Path:
    return Path(os.environ.get("BATTUTA_ARTIFACT_DB", "~/.battuta/artifacts/registry.sqlite3")).expanduser().absolute()


def public_base_url() -> str:
    return os.environ.get("BATTUTA_ARTIFACT_BASE_URL", "https://pi.fiscum.co.uk/artifacts").rstrip("/")
