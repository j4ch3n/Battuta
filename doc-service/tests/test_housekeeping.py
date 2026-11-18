import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace

import pypdfium2
import pytest
from docling_core.types.doc import DoclingDocument

from battuta_doc.config import DocError, Settings
from battuta_doc.jobs import JobManager
from battuta_doc.options import ConvertOptions
from battuta_doc.server import dispatch

OPTS = ConvertOptions.from_args()


class Conv:
    def convert(self, source, options, on_progress):
        return DoclingDocument(name="d"), []


def make_pdf(path, pages=2):
    pdf = pypdfium2.PdfDocument.new()
    for _ in range(pages):
        pdf.new_page(100, 100)
    pdf.save(path)


@pytest.fixture
def mgr(tmp_path):
    env = {"BATTUTA_DOC_DATA_DIR": str(tmp_path / "data"), "BATTUTA_DOC_INPUT_ROOTS": str(tmp_path)}
    settings = Settings.from_env(env)
    return JobManager(settings, Conv(), SimpleNamespace(state="ready", health=lambda: {"ready": True, "state": "ready", "error": None}))


def convert(mgr, path):
    async def noop(s):
        pass
    return asyncio.run(mgr.convert(path, OPTS, noop))


def test_page_image_renders_once_and_reuses_file(mgr, tmp_path):
    make_pdf(tmp_path / "a.pdf")
    doc_id = convert(mgr, tmp_path / "a.pdf").doc_id
    first = mgr.page_image(doc_id, 2)
    stamp = first.stat().st_mtime_ns
    assert first.name == "p002.png" and first.parent.name == "pages" and mgr.page_image(doc_id, 2).stat().st_mtime_ns == stamp


@pytest.mark.parametrize("page,scale,message", [(0, 1.5, "page"), (3, 1.5, "available pages: 1-2"), (1, 4, "scale")])
def test_page_image_validation(mgr, tmp_path, page, scale, message):
    make_pdf(tmp_path / "a.pdf")
    doc_id = convert(mgr, tmp_path / "a.pdf").doc_id
    with pytest.raises(DocError) as e:
        mgr.page_image(doc_id, page, scale)
    assert e.value.code == "invalid_option" and message in e.value.message


def test_page_image_unknown_doc(mgr):
    with pytest.raises(DocError) as e:
        mgr.page_image("f" * 16, 1)
    assert e.value.code == "not_found"


def test_page_image_rejects_non_pdf_source(mgr, tmp_path):
    (tmp_path / "a.docx").write_bytes(b"docx")
    doc_id = convert(mgr, tmp_path / "a.docx").doc_id
    with pytest.raises(DocError) as e:
        mgr.page_image(doc_id, 1)
    assert e.value.code == "unsupported_format"


def run(mgr, name, args):
    settings = replace(mgr.settings)
    models = SimpleNamespace(health=lambda: {"ready": True, "state": "ready", "error": None})
    return json.loads(asyncio.run(dispatch(name, args, settings=settings, jobs=mgr, models=models))[0].text)


def test_status_reports_models_queue_limits_and_cache_size(mgr, tmp_path):
    make_pdf(tmp_path / "a.pdf")
    convert(mgr, tmp_path / "a.pdf")
    out = run(mgr, "doc_service_status", {})
    assert out["ready"] and out["jobs"] == {"running": [], "queued": []} and out["cache_bytes"] > 0
    assert out["limits"]["max_queue"] == 4


def test_list_and_delete(mgr, tmp_path):
    make_pdf(tmp_path / "a.pdf")
    doc_id = convert(mgr, tmp_path / "a.pdf").doc_id
    rows = run(mgr, "doc_list", {})["documents"]
    assert [r["doc_id"] for r in rows] == [doc_id] and rows[0]["source_name"] == "a.pdf"
    assert run(mgr, "doc_delete", {"doc_id": doc_id}) == {"deleted": 1}
    assert run(mgr, "doc_list", {})["documents"] == []


@pytest.mark.parametrize("args", [{}, {"doc_id": "a" * 16, "older_than_days": 1}])
def test_delete_requires_exactly_one_selector(mgr, args):
    with pytest.raises(DocError) as e:
        run(mgr, "doc_delete", args)
    assert e.value.code == "invalid_option"
