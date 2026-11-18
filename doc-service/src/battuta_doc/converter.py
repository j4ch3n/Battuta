"""Docling adapter: maps ConvertOptions to a pipeline and normalizes errors."""

from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from .config import DocError, Settings
from .options import ConvertOptions

Progress = Callable[[str, int, int], None]


class Converter(Protocol):
    def convert(self, source: Path, options: ConvertOptions, on_progress: Progress) -> tuple[Any, list[str]]: ...


def _default_ocr_factory(kind: str, lang: list[str]):
    from docling.models.factories import get_ocr_factory

    kwargs = {"lang": lang} if lang else {}
    return get_ocr_factory().create_options(kind=kind, **kwargs)


def build_pipeline_options(options: ConvertOptions, artifacts_path: Path | None, *, ocr_engine: str = "auto",
                           ocr_factory: Callable[[str, list[str]], Any] = _default_ocr_factory):
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions, PictureDescriptionVlmEngineOptions, TableFormerMode)

    p = PdfPipelineOptions()
    p.artifacts_path = artifacts_path
    p.do_ocr = options.ocr != "off"
    if p.do_ocr:
        p.ocr_options = ocr_factory(ocr_engine, list(options.ocr_languages))
        p.ocr_options.force_full_page_ocr = options.ocr == "force"
    p.do_table_structure = options.tables != "off"
    if p.do_table_structure:
        p.table_structure_options.mode = TableFormerMode.FAST if options.tables == "fast" else TableFormerMode.ACCURATE
    p.do_chart_extraction = options.charts
    p.do_formula_enrichment = options.formulas
    p.do_picture_classification = options.figures != "off"
    p.do_picture_description = options.figures == "describe"
    if p.do_picture_description:
        p.picture_description_options = PictureDescriptionVlmEngineOptions.from_preset("smolvlm")
    p.generate_picture_images = options.figures != "off" or options.charts
    p.images_scale = 2.0
    return p


def count_pdf_pages(path: Path) -> int | None:
    if path.suffix.lower() != ".pdf":
        return None
    import pypdfium2

    try:
        pdf = pypdfium2.PdfDocument(path)
    except pypdfium2.PdfiumError as error:
        raise _map_error(error) from error
    try:
        return len(pdf)
    finally:
        pdf.close()


def _map_error(error: Exception) -> DocError:
    if isinstance(error, DocError):
        return error
    text = str(error).lower()
    if "password" in text or "encrypt" in text:
        return DocError("encrypted", "document is password protected")
    return DocError("unreadable", f"document could not be read: {str(error)[:200]}")


class DoclingConverter:
    def __init__(self, settings: Settings, models_dir: Path, *, page_counter=count_pdf_pages,
                 converter_factory=None, ocr_factory=_default_ocr_factory):
        self.settings = settings
        self.models_dir = models_dir
        self._count = page_counter
        self._factory = converter_factory or self._docling_converter
        self._ocr_factory = ocr_factory

    def _docling_converter(self, pipeline_options):
        from docling.datamodel.base_models import InputFormat
        from docling.document_converter import DocumentConverter, PdfFormatOption

        fmt = PdfFormatOption(pipeline_options=pipeline_options)
        return DocumentConverter(format_options={InputFormat.PDF: fmt, InputFormat.IMAGE: fmt})

    def convert(self, source: Path, options: ConvertOptions, on_progress: Progress):
        from docling.datamodel.base_models import ConversionStatus

        total = self._count(source)
        kwargs: dict[str, Any] = {}
        warnings: list[str] = []
        if total is not None:
            if total > self.settings.max_pages:
                raise DocError("too_many_pages", f"document has {total} pages; limit is {self.settings.max_pages}")
            if options.pages:
                if options.pages[-1] > total:
                    raise DocError("invalid_option", f"pages go beyond the document's {total} pages")
                kwargs["page_range"] = (options.pages[0], options.pages[-1])
                if len(options.pages) != options.pages[-1] - options.pages[0] + 1:
                    warnings.append("non-contiguous pages: converted the full range from first to last requested page")
            elif total == 0:
                warnings.append("document has no pages")
        converter = self._factory(build_pipeline_options(
            options, self.models_dir, ocr_engine=self.settings.ocr_engine, ocr_factory=self._ocr_factory))

        def progress(event) -> None:
            kind = getattr(event, "kind", None)
            kind = getattr(kind, "value", kind)
            if kind == "page_completed":
                on_progress("layout", event.completed_pages, event.total_pages)
            elif kind == "enrichment_progress":
                step = getattr(event.step, "value", event.step)
                on_progress("charts" if step == "chart_extraction" else "enrich", event.completed_items, event.total_items)

        try:
            result = converter.convert(source, raises_on_error=False, progress_callback=progress, **kwargs)
        except Exception as error:
            raise _map_error(error) from error
        if result.status == ConversionStatus.FAILURE:
            errors = "; ".join(getattr(e, "error_message", str(e)) for e in result.errors)
            raise _map_error(RuntimeError(errors)) if "password" in errors.lower() else DocError(
                "conversion_failed", errors[:300] or "conversion failed")
        if result.status == ConversionStatus.PARTIAL_SUCCESS:
            failed = [str(e.error_message if hasattr(e, "error_message") else e) for e in result.errors]
            warnings.append("partial conversion: " + ("; ".join(failed)[:300] or "some pages failed"))
        return result.document, warnings
