import tempfile
import unittest
from pathlib import Path


class FileTests(unittest.TestCase):
    def test_open_handle_stays_pinned_when_path_is_replaced(self):
        from battuta_artifacts.files import open_source

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "app.js"
            path.write_bytes(b"original")
            with open_source(str(root), "app.js") as source:
                path.unlink()
                path.symlink_to(root / "private.txt")
                (root / "private.txt").write_bytes(b"secret")
                self.assertEqual(source.read(), b"original")
