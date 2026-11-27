from types import SimpleNamespace

import pytest
from docling.datamodel.base_models import ConversionStatus

from battuta_doc.config import DocError, Settings
from battuta_doc.converter import DoclingConverter, build_pipeline_options
from battuta_doc.options import ConvertOptions


def opts(**kw):
    return ConvertOptions.from_args(**kw)


class FakeOcr:
    def __init__(self):
        self.force_full_page_ocr = False


@pytest.mark.parametrize("kw,expect", [
    ({}, dict(do_ocr=True, force=False, do_table_structure=True, mode="accurate", charts=True, formulas=False, describe=False, images=True)),
    ({"ocr": "off", "tables": "off", "charts": False, "figures": "off"}, dict(do_ocr=False, do_table_structure=False, charts=False, images=False, describe=False)),
    ({"ocr": "force", "tables": "fast", "formulas": True, "figures": "describe"},
     dict(do_ocr=True, force=True, mode="fast", formulas=True, describe=True, images=True)),
], ids=["defaults", "features-off", "force-fast-describe"])
def test_pipeline_options_mapping(kw, expect):
    p = build_pipeline_options(opts(**kw), None, ocr_factory=lambda kind, lang: FakeOcr())
    got = {"do_ocr": p.do_ocr, "do_table_structure": p.do_table_structure, "charts": p.do_chart_extraction,
           "formulas": p.do_formula_enrichment, "describe": p.do_picture_description, "images": p.generate_picture_images}
    if p.do_ocr:
        got["force"] = p.ocr_options.force_full_page_ocr
    if p.do_table_structure:
        got["mode"] = p.table_structure_options.mode.value
    for key, value in expect.items():
        assert got[key] == value, key


def test_ocr_engine_and_languages_passed_to_ocr_options():
    seen = []
    settings = Settings.from_env({"BATTUTA_DOC_OCR_ENGINE": "rapidocr"})
    conv = DoclingConverter(settings, None, page_counter=lambda p: 1, converter_factory=lambda po: fake_converter(),
                            ocr_factory=lambda kind, lang: seen.append((kind, lang)) or FakeOcr())
    conv.convert(__import__("pathlib").Path("a.pdf"), opts(ocr_languages="en,de"), lambda *a: None)
    assert seen == [("rapidocr", ["en", "de"])]


def fake_converter(status=ConversionStatus.SUCCESS, errors=(), raises=None, calls=None):
    class C:
        def convert(self, source, **kw):
            if calls is not None:
                calls.append(kw)
            if raises:
                raise raises
            return SimpleNamespace(status=status, errors=list(errors), document="DOC")
    return C()


def make(tmp_path, pages=3, **kw):
    settings = Settings.from_env({"BATTUTA_DOC_MAX_PAGES": "5"})
    return DoclingConverter(settings, tmp_path, page_counter=lambda p: pages, **kw)


def run(conv, **kw):
    from pathlib import Path
    return conv.convert(Path("a.pdf"), opts(**kw), lambda *a: None)


def test_page_range_passed_and_noncontiguous_warns(tmp_path):
    calls = []
    conv = make(tmp_path, converter_factory=lambda po: fake_converter(calls=calls))
    doc, warnings = run(conv, pages="1,3")
    assert calls[0]["page_range"] == (1, 3) and warnings


def test_page_limit_enforced_before_conversion(tmp_path):
    def boom(po):
        raise AssertionError("converter must not be built")
    conv = make(tmp_path, pages=6, converter_factory=boom)
    with pytest.raises(DocError) as e:
        run(conv)
    assert e.value.code == "too_many_pages"


@pytest.mark.parametrize("error,kw,code", [
    (RuntimeError("File is password protected"), {}, "encrypted"),
    (RuntimeError("bad xref table"), {}, "unreadable"),
    (None, {"pages": "2-9"}, "invalid_option"),
], ids=["encrypted", "unreadable", "pages-beyond-document"])
def test_error_mapping(tmp_path, error, kw, code):
    conv = make(tmp_path, converter_factory=lambda po: fake_converter(raises=error))
    with pytest.raises(DocError) as e:
        run(conv, **kw)
    assert e.value.code == code


@pytest.mark.parametrize("status,warns,code", [
    (ConversionStatus.SUCCESS, False, None),
    (ConversionStatus.PARTIAL_SUCCESS, True, None),
    (ConversionStatus.FAILURE, False, "conversion_failed"),
], ids=["success", "partial-success", "failure"])
def test_conversion_status_mapping(tmp_path, status, warns, code):
    err = SimpleNamespace(error_message="page 2 failed")
    conv = make(tmp_path, converter_factory=lambda po: fake_converter(status=status, errors=[err]))
    if code:
        with pytest.raises(DocError) as e:
            run(conv)
        assert e.value.code == code
        return
    doc, warnings = run(conv)
    assert doc == "DOC" and bool(warnings) == warns
    if warns:
        assert "page 2 failed" in warnings[0]
