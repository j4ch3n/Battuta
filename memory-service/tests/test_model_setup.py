import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from battuta_memory import model_setup as models


class ModelSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)

    def archive(self, extra=None):
        archive = self.home / "model.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name, content in (("onnx/model.onnx", b"model"), ("onnx/tokenizer.json", b"{}")):
                info = tarfile.TarInfo(name)
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))
            if extra:
                tar.addfile(extra)
        return archive

    def test_cold_install_and_offline_warm_verify(self):
        archive = self.archive()
        with patch.object(models, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest()):
            first = models.install_model(archive, self.home)
            self.assertEqual(first["dimension"], 384)
            self.assertEqual(first["provider"], "CPUExecutionProvider")
            with patch.object(models, "download", side_effect=AssertionError("network forbidden")):
                self.assertEqual(models.install_model(None, self.home), first)
                self.assertEqual(models.verify_model(self.home), first)

    def test_checksum_failure_never_publishes_cache(self):
        with self.assertRaisesRegex(RuntimeError, "checksum"):
            models.install_model(self.archive(), self.home)
        self.assertFalse(models.model_folder(self.home).exists())

    def test_partial_cache_is_not_replaced_silently(self):
        folder = models.model_folder(self.home)
        folder.mkdir(parents=True)
        (folder / "model.onnx").write_bytes(b"unknown local weights")
        with self.assertRaisesRegex(RuntimeError, "existing"):
            models.install_model(self.archive(), self.home)
        self.assertEqual((folder / "model.onnx").read_bytes(), b"unknown local weights")

    def test_corrupt_tokenizer_and_wrong_home_rejected(self):
        archive = self.archive()
        with patch.object(models, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest()):
            models.install_model(archive, self.home)
            (models.model_folder(self.home) / "tokenizer.json").write_text("corrupt")
            with self.assertRaises(RuntimeError):
                models.verify_model(self.home)
            with self.assertRaises(RuntimeError):
                models.verify_model(self.home / "other-user")

    def test_untrusted_archive_paths_and_links_refused(self):
        for name, kind in (("../escape", tarfile.REGTYPE), ("onnx/link", tarfile.SYMTYPE), ("onnx/hard", tarfile.LNKTYPE)):
            with self.subTest(name=name):
                info = tarfile.TarInfo(name)
                info.type = kind
                info.linkname = "/etc/passwd"
                archive = self.archive(info)
                with patch.object(models, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest()):
                    with self.assertRaisesRegex(RuntimeError, "Unsafe"):
                        models.install_model(archive, self.home)

    def test_disk_shortage_before_download(self):
        with patch.object(models.shutil, "disk_usage", return_value=type("Disk", (), {"free": 0})()), patch.object(models, "download", side_effect=AssertionError("must not download")):
            with self.assertRaisesRegex(RuntimeError, "disk"):
                models.install_model(None, self.home)

    def test_interrupted_download_does_not_publish_model(self):
        def interrupt(path):
            path.write_bytes(b"partial")
            raise OSError("connection interrupted")
        with patch.object(models, "download", side_effect=interrupt):
            with self.assertRaises(OSError):
                models.install_model(None, self.home)
        self.assertFalse(models.model_folder(self.home).exists())
