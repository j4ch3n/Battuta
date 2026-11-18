import pytest

from battuta_doc.config import DocError, Settings, resolve_source


def make_settings(tmp_path, **overrides):
    env = {"BATTUTA_DOC_DATA_DIR": str(tmp_path / "data"), "BATTUTA_DOC_INPUT_ROOTS": str(tmp_path / "root")}
    env.update(overrides)
    (tmp_path / "root").mkdir(exist_ok=True)
    return Settings.from_env(env)


def test_settings_defaults_match_spec():
    s = Settings.from_env({"HOME": "/home/x"})
    assert (s.max_bytes, s.max_pages, s.max_wait, s.job_timeout, s.max_queue, s.retention_days) == (
        104857600, 500, 900, 3600, 4, 14)
    assert s.ocr_engine == "auto"
    assert str(s.data_dir).endswith(".battuta/doc-service")
    assert [str(p).endswith(".battuta/projects") for p in s.input_roots] == [True]


def test_settings_env_overrides_and_blank_engine():
    s = Settings.from_env({"BATTUTA_DOC_MAX_PAGES": "7", "BATTUTA_DOC_OCR_ENGINE": " "})
    assert s.max_pages == 7 and s.ocr_engine == "auto"


@pytest.mark.parametrize("value", ["0", "-1", "abc"])
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
    ("url", "invalid_source"),
    ("missing", "not_found"),
    ("directory", "invalid_source"),
    ("symlink_out", "path_not_allowed"),
    ("outside", "path_not_allowed"),
    ("big", "too_large"),
])
def test_resolve_source_rejects(tmp_path, case, code):
    s = make_settings(tmp_path, BATTUTA_DOC_MAX_BYTES="10")
    root = tmp_path / "root"
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"x")
    (root / "dir").mkdir()
    (root / "link.pdf").symlink_to(outside)
    (root / "big.pdf").write_bytes(b"x" * 11)
    source = {
        "relative": "a.pdf", "url": "https://x/a.pdf", "missing": str(root / "none.pdf"),
        "directory": str(root / "dir"), "symlink_out": str(root / "link.pdf"),
        "outside": str(outside), "big": str(root / "big.pdf"),
    }[case]
    with pytest.raises(DocError) as e:
        resolve_source(s, source)
    assert e.value.code == code
