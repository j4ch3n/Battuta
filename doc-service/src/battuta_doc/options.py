"""Conversion options, page specs and document ids."""

from collections.abc import Sequence
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path

from .config import DocError

OCR = ("auto", "off", "force")
TABLES = ("off", "fast", "accurate")
FIGURES = ("off", "extract", "describe")


def parse_pages(spec: str | None) -> tuple[int, ...] | None:
    if spec is None:
        return None
    pages: set[int] = set()
    try:
        for part in spec.split(","):
            lo, _, hi = part.strip().partition("-")
            start, end = int(lo), int(hi or lo)
            if start < 1 or end < start:
                raise ValueError
            pages.update(range(start, end + 1))
    except ValueError:
        raise DocError("invalid_option", f"invalid pages spec: {spec!r}") from None
    return tuple(sorted(pages))


def parse_languages(value: str | Sequence[str] | None) -> tuple[str, ...]:
    if value is None:
        return ()
    items = value.split(",") if isinstance(value, str) else value
    return tuple(i.strip() for i in items if i and i.strip())


@dataclass(frozen=True)
class ConvertOptions:
    pages: tuple[int, ...] | None = None
    ocr: str = "auto"
    ocr_languages: tuple[str, ...] = ()
    tables: str = "accurate"
    figures: str = "extract"
    charts: bool = True
    formulas: bool = False

    @classmethod
    def from_args(cls, *, pages: str | None = None, ocr: str = "auto", ocr_languages=None,
                  tables: str = "accurate", figures: str = "extract", charts: bool = True,
                  formulas: bool = False) -> "ConvertOptions":
        for name, value, allowed in (("ocr", ocr, OCR), ("tables", tables, TABLES), ("figures", figures, FIGURES)):
            if value not in allowed:
                raise DocError("invalid_option", f"{name} must be one of {', '.join(allowed)}")
        return cls(parse_pages(pages), ocr, parse_languages(ocr_languages), tables, figures, bool(charts), bool(formulas))

    def cache_key(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def make_doc_id(sha256: str, suffix: str, options: ConvertOptions, docling_version: str) -> str:
    key = "\0".join((sha256, suffix.lower(), options.cache_key(), docling_version))
    return hashlib.sha256(key.encode()).hexdigest()[:16]
