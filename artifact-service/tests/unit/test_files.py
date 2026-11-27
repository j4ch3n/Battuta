from battuta_artifacts.files import open_source


def test_open_handle_stays_pinned_when_path_is_replaced(tmp_path):
    root = tmp_path.resolve()
    path = root / "app.js"
    path.write_bytes(b"original")
    with open_source(str(root), "app.js") as source:
        path.unlink()
        path.symlink_to(root / "private.txt")
        (root / "private.txt").write_bytes(b"secret")
        assert source.read() == b"original"
