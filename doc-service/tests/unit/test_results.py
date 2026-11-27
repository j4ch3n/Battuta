from pathlib import Path

import pytest
from docling_core.types.doc import DoclingDocument

from battuta_doc.options import ConvertOptions
from battuta_doc.results import clean, page_line_table, write_result

DATA = Path(__file__).parents[1] / "data"
OPTS = ConvertOptions.from_args()


def load(name):
    return DoclingDocument.load_from_json(DATA / name)


@pytest.fixture(scope="module")
def paper(tmp_path_factory):
    out = tmp_path_factory.mktemp("paper")
    summary = write_result(load("2203.01017v2.json"), out, source_name="paper.pdf", options=OPTS)
    return out, summary


def test_fixture_paper_counts_in_index(paper):
    out, summary = paper
    index = (out / "INDEX.md").read_text()
    assert len(list((out / "tables").glob("*.csv"))) == 38
    assert summary.counts == {"pages": 16, "tables": 38, "figures": 24}
    figs = [l for l in index.splitlines() if l.startswith("- fig-")]
    assert len(figs) == 24 and all(l.endswith("no image data") for l in figs)
    assert not list((out / "figures").glob("*.png"))
    assert all(f"| p.{n} |" in index for n in range(1, 17))
    table_lines = [l for l in index.splitlines() if l.startswith("- tables/")]
    assert sum("caption:" in l for l in table_lines) == 8
    assert sum("header:" in l for l in table_lines) == 30


def test_outline_lists_headings_with_page_numbers_and_levels(paper):
    index = (paper[0] / "INDEX.md").read_text()
    outline = index.split("## Outline\n")[1].split("\n\n")[0].splitlines()
    assert outline and all(" p." in l for l in outline)
    assert any(l.startswith("  - ") for l in outline) or any(l.startswith("- ") for l in outline)


def test_writes_expected_files_and_stays_inside_out_dir(paper, tmp_path):
    out, _ = paper
    assert {p.name for p in out.iterdir()} == {"INDEX.md", "document.md", "document.json", "tables", "figures"}
    assert "<!-- fig-024 -->" in (out / "document.md").read_text()


def test_page_line_table_covers_every_page_without_gaps():
    md = "\n".join(f"line{i}" for i in range(1, 11))
    rows = page_line_table(md, [1, 4, 8])
    assert rows == [(1, 1, 3), (2, 4, 7), (3, 8, 10)]


def test_figure_png_chart_csv_and_kind(tmp_path):
    from PIL import Image
    from docling_core.types.doc import ImageRef, PictureMeta
    from docling_core.types.doc.document import PictureClassificationMetaField, PictureClassificationPrediction, TabularChartMetaField
    from docling_core.types.doc.base import Size

    doc = DoclingDocument(name="d")
    doc.add_page(page_no=1, size=Size(width=10, height=10))
    pic = doc.add_picture(image=ImageRef.from_pil(Image.new("RGB", (4, 4)), dpi=72))
    pic.meta = PictureMeta(
        classification=PictureClassificationMetaField(predictions=[PictureClassificationPrediction(class_name="bar_chart", confidence=0.9)]),
        tabular_chart=TabularChartMetaField(chart_data=_chart_data()),
    )
    summary = write_result(doc, tmp_path, source_name="x.pdf", options=OPTS)
    index = summary.index.read_text()
    assert (tmp_path / "figures/fig-001.png").exists()
    assert (tmp_path / "figures/fig-001.csv").read_text() == "year,value\n2020,5\n"
    assert "kind: bar\\_chart" in index and "chart data: figures/fig-001.csv" in index


def _chart_data():
    from docling_core.types.doc import TableCell, TableData
    cells = [TableCell(text=t, start_row_offset_idx=r, end_row_offset_idx=r + 1, start_col_offset_idx=c, end_col_offset_idx=c + 1)
             for r, row in enumerate([["year", "value"], ["2020", "5"]]) for c, t in enumerate(row)]
    return TableData(num_rows=2, num_cols=2, table_cells=cells)


def test_table_caption_and_header_row(tmp_path):
    from docling_core.types.doc import TableCell, TableData
    doc = DoclingDocument(name="d")
    cells = [TableCell(text=t, start_row_offset_idx=0, end_row_offset_idx=1, start_col_offset_idx=c, end_col_offset_idx=c + 1)
             for c, t in enumerate(["Name", "Qty"])]
    doc.add_table(data=TableData(num_rows=1, num_cols=2, table_cells=cells))
    index = write_result(doc, tmp_path, source_name="x.pdf", options=OPTS).index.read_text()
    assert "1x2" in index and "header: Name, Qty" in index


@pytest.mark.parametrize("name", ["a\nb\n## injected", "../../etc/passwd", "résumé 文档.pdf"])
def test_hostile_source_name(tmp_path, name):
    out = tmp_path / "out"
    summary = write_result(load("lorem_ipsum.docx.json"), out, source_name=name, options=OPTS)
    index = summary.index.read_text()
    assert index.splitlines()[0].startswith("# ") and "\n## injected" not in index
    assert all(len(l.split()) >= 1 for l in summary.tree.splitlines())
    assert {p.name for p in tmp_path.iterdir()} == {"out"}
    assert clean(name).count("\n") == 0


def test_empty_document_renders_empty_lists_and_warning(tmp_path):
    summary = write_result(DoclingDocument(name="e"), tmp_path, source_name="e.pdf", options=OPTS)
    index = summary.index.read_text()
    assert summary.counts == {"pages": 0, "tables": 0, "figures": 0} and summary.warnings
    assert "none (document has no pages)" in index and "## Figures\nnone" in index and "## Tables\nnone" in index
