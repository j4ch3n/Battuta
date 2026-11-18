import pytest

from battuta_doc.config import DocError
from battuta_doc.options import ConvertOptions, make_doc_id, parse_languages, parse_pages


@pytest.mark.parametrize("spec,expected", [("1-3,9", (1, 2, 3, 9)), ("2,1", (1, 2))])
def test_parse_pages(spec, expected):
    assert parse_pages(spec) == expected


@pytest.mark.parametrize("spec", ["3-1", "0", "a"])
def test_parse_pages_invalid(spec):
    with pytest.raises(DocError) as e:
        parse_pages(spec)
    assert e.value.code == "invalid_option"


@pytest.mark.parametrize("value,expected", [
    ("en, de", ("en", "de")), (["en", " "], ("en",)), (None, ()),
])
def test_parse_languages(value, expected):
    assert parse_languages(value) == expected


def test_defaults():
    o = ConvertOptions.from_args()
    assert (o.ocr, o.tables, o.figures, o.charts, o.formulas, o.pages) == ("auto", "accurate", "extract", True, False, None)


@pytest.mark.parametrize("field,value", [("ocr", "x")])
def test_options_reject_unknown_enum(field, value):
    with pytest.raises(DocError) as e:
        ConvertOptions.from_args(**{field: value})
    assert e.value.code == "invalid_option"


def test_doc_id_stable_and_option_sensitive():
    base = ConvertOptions.from_args()
    h = "a" * 64
    ident = make_doc_id(h, ".pdf", base, "1")
    assert len(ident) == 16
    assert ident == make_doc_id(h, ".PDF", base, "1")
    assert make_doc_id(h, ".pdf", ConvertOptions.from_args(pages="2,1"), "1") == make_doc_id(
        h, ".pdf", ConvertOptions.from_args(pages="1,2"), "1")
    for other in (
        make_doc_id(h, ".pdf", ConvertOptions.from_args(charts=False), "1"),
        make_doc_id(h, ".pdf", ConvertOptions.from_args(ocr="force"), "1"),
        make_doc_id(h, ".docx", base, "1"),
        make_doc_id(h, ".pdf", base, "2"),
        make_doc_id("b" * 64, ".pdf", base, "1"),
    ):
        assert other != ident

