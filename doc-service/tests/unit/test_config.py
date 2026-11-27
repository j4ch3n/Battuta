import pytest

from battuta_doc.config import DocError, Settings, resolve_source


def make_settings(tmp_path, **overrides):
    env = {"BATTUTA_DOC_DATA_DIR": str(tmp_path / "data"), "BATTUTA_DOC_INPUT_ROOTS": str(tmp_path / "root")}
    env.update(overrides)
    (tmp_path / "root").mkdir(exist_ok=True)
    return Settings.from_env(env)


def test_settings_default_locations_and_env_overrides():
    s = Settings.from_env({"HOME": "/home/x", "BATTUTA_DOC_MAX_PAGES": "7", "BATTUTA_DOC_OCR_ENGINE": " "})
    assert s.max_pages == 7 and s.ocr_engine == "auto"
    assert str(s.data_dir).endswith(".battuta/doc-service")
    assert [str(p).endswith(".battuta/projects") for p in s.input_roots] == [True]


@pytest.mark.parametrize("value", ["0", "abc"], ids=["zero", "non-numeric"])
def test_settings_reject_non_positive(value):
    with pytest.raises(DocError) as e:
        Settings.from_env({"BATTUTA_DOC_MAX_QUEUE": value})
    assert e.value.code == "invalid_config"


def test_resolve_source_accepts_file_in_root(tmp_path):
    s = make_settings(tmp_path)
    f = tmp_path / "root" / "a.pdf"
    f.write_bytes(b"x")
    assert resolve_source(s, str(f)) == f.resolve()


@pytest.mark.parametrize("case,code", [
    ("relative", "invalid_source"),
    ("missing", "not_found"),
    ("directory", "invalid_source"),
    ("symlink_out", "path_not_allowed"),
    ("big", "too_large"),
], ids=["relative", "missing", "directory", "symlink-outside-root", "too-large"])
def test_resolve_source_rejects(tmp_path, case, code):
    s = make_settings(tmp_path, BATTUTA_DOC_MAX_BYTES="10")
    root = tmp_path / "root"
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"x")
    (root / "dir").mkdir()
    (root / "link.pdf").symlink_to(outside)
    (root / "big.pdf").write_bytes(b"x" * 11)
    source = {
        "relative": "a.pdf", "missing": str(root / "none.pdf"),
        "directory": str(root / "dir"), "symlink_out": str(root / "link.pdf"), "big": str(root / "big.pdf"),
    }[case]
    with pytest.raises(DocError) as e:
        resolve_source(s, source)
    assert e.value.code == code
