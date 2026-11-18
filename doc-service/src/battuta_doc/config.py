"""Service settings and source path validation."""

from collections.abc import Mapping
from dataclasses import dataclass
import os
from pathlib import Path


class DocError(Exception):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    input_roots: tuple[Path, ...]
    max_bytes: int
    max_pages: int
    max_wait: int
    job_timeout: int
    max_queue: int
    retention_days: int
    ocr_engine: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        home = Path(env.get("HOME") or Path.home())

        def number(name: str, default: int) -> int:
            raw = env.get(name)
            if raw is None or raw.strip() == "":
                return default
            try:
                value = int(raw)
            except ValueError:
                value = 0
            if value <= 0:
                raise DocError("invalid_config", f"{name} must be a positive integer")
            return value

        roots = env.get("BATTUTA_DOC_INPUT_ROOTS") or str(home / ".battuta/projects")
        return cls(
            data_dir=Path(env.get("BATTUTA_DOC_DATA_DIR") or home / ".battuta/doc-service"),
            input_roots=tuple(Path(r).expanduser().resolve() for r in roots.split(os.pathsep) if r.strip()),
            max_bytes=number("BATTUTA_DOC_MAX_BYTES", 104857600),
            max_pages=number("BATTUTA_DOC_MAX_PAGES", 500),
            max_wait=number("BATTUTA_DOC_MAX_WAIT_SECONDS", 900),
            job_timeout=number("BATTUTA_DOC_JOB_TIMEOUT_SECONDS", 3600),
            max_queue=number("BATTUTA_DOC_MAX_QUEUE", 4),
            retention_days=number("BATTUTA_DOC_RETENTION_DAYS", 14),
            ocr_engine=(env.get("BATTUTA_DOC_OCR_ENGINE") or "").strip() or "auto",
        )


def resolve_source(settings: Settings, source: str) -> Path:
    if "://" in source or not os.path.isabs(source):
        raise DocError("invalid_source", "source must be an absolute local file path")
    try:
        path = Path(source).resolve(strict=True)
    except OSError:
        raise DocError("not_found", "source file does not exist") from None
    if not any(path.is_relative_to(root) for root in settings.input_roots):
        raise DocError("path_not_allowed", "source is outside the allowed input roots")
    if not path.is_file():
        raise DocError("invalid_source", "source must be a regular file")
    if path.stat().st_size > settings.max_bytes:
        raise DocError("too_large", f"source exceeds {settings.max_bytes} bytes")
    return path
