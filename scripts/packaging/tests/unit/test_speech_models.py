import hashlib
import io
import tarfile
from pathlib import Path

import pytest

from battuta_packaging import speech_models as models


def archive(name, content=b"weights", kind=tarfile.REGTYPE):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w:bz2") as tar:
        entry = tarfile.TarInfo(name)
        entry.type = kind
        if kind == tarfile.SYMTYPE:
            entry.linkname = "../../outside"
        else:
            entry.size = len(content)
        tar.addfile(entry, io.BytesIO(content) if kind == tarfile.REGTYPE else None)
    return result.getvalue()


def test_install_reuses_verified_assets(tmp_path, monkeypatch):
    data = archive("model/model.onnx")
    assets = [models.Asset("model", "https://example.test/model", hashlib.sha256(data).hexdigest(), ("model/model.onnx",))]
    monkeypatch.setattr(models, "ASSETS", assets)
    monkeypatch.setattr(models, "download", lambda url, target: target.write_bytes(data))
    models.install_models(tmp_path)
    assert (tmp_path / ".battuta/speech-service/model/model.onnx").read_bytes() == b"weights"
    monkeypatch.setattr(models, "download", lambda *args: pytest.fail("downloaded twice"))
    models.install_models(tmp_path)


@pytest.mark.parametrize("name,kind", [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE), ("model/../../escape", tarfile.REGTYPE), ("model/link", tarfile.SYMTYPE)],
                         ids=["parent-traversal", "absolute-path", "nested-traversal", "symlink-member"])
def test_rejects_unsafe_archives(tmp_path, monkeypatch, name, kind):
    data = archive(name, kind=kind)
    monkeypatch.setattr(models, "ASSETS", [models.Asset("model", "https://example.test/model", hashlib.sha256(data).hexdigest(), (name,))])
    monkeypatch.setattr(models, "download", lambda url, target: target.write_bytes(data))
    with pytest.raises(ValueError, match="Unsafe model archive"):
        models.install_models(tmp_path)
    assert not (tmp_path / "escape").exists()


def test_installs_and_verifies_reference_voice(tmp_path, monkeypatch):
    voice = b"reference audio"
    asset = models.Asset("voice", "https://example.test/voice", hashlib.sha256(voice).hexdigest(), ("voice.wav",), raw=True)
    monkeypatch.setattr(models, "ASSETS", [asset])
    monkeypatch.setattr(models, "download", lambda url, target: target.write_bytes(voice))
    models.install_models(tmp_path)
    path = tmp_path / ".battuta/speech-service/voice.wav"
    assert path.read_bytes() == voice
    path.write_bytes(b"changed")
    with pytest.raises(ValueError):
        models.verify_models(tmp_path)


def test_rejects_bad_download_without_installing(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "ASSETS", [models.Asset("voice", "https://example.test/voice", "0" * 64, ("voice.wav",), raw=True)])
    monkeypatch.setattr(models, "download", lambda url, target: target.write_bytes(b"bad"))
    with pytest.raises(ValueError, match="Checksum"):
        models.install_models(tmp_path)
    assert not (tmp_path / ".battuta/speech-service").exists()


def test_interrupted_download_leaves_no_installation(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "ASSETS", [models.Asset("voice", "https://example.test/voice", "0" * 64, ("voice.wav",), raw=True)])

    def interrupted(url, target):
        target.write_bytes(b"partial")
        raise OSError("connection lost")

    monkeypatch.setattr(models, "download", interrupted)
    with pytest.raises(OSError, match="connection lost"):
        models.install_models(tmp_path)
    assert not (tmp_path / ".battuta/speech-service").exists()
    assert list((tmp_path / ".battuta").iterdir()) == []


def private_directory(root):
    target = root / ".battuta/speech-service"
    target.mkdir(parents=True)
    (target / "private").write_text("keep")


def symlinked_battuta(root):
    outside = root / "outside"
    outside.mkdir()
    (root / ".battuta").symlink_to(outside, target_is_directory=True)


@pytest.mark.parametrize("prepare", [private_directory, symlinked_battuta], ids=["unknown-existing-directory", "symlinked-battuta"])
def test_rejects_unsafe_install_root_without_touching_it(tmp_path, monkeypatch, prepare):
    prepare(tmp_path)
    monkeypatch.setattr(models, "ASSETS", [])
    before = {path: path.read_bytes() if path.is_file() else None for path in tmp_path.rglob("*")}
    with pytest.raises(ValueError):
        models.install_models(tmp_path)
    assert {path: path.read_bytes() if path.is_file() else None for path in tmp_path.rglob("*")} == before


def test_rejects_installed_model_from_different_release(tmp_path, monkeypatch):
    data = archive("model/model.onnx")
    asset = models.Asset("model", "https://example.test/model", hashlib.sha256(data).hexdigest(), ("model/model.onnx",))
    monkeypatch.setattr(models, "ASSETS", [asset])
    monkeypatch.setattr(models, "download", lambda url, target: target.write_bytes(data))
    models.install_models(tmp_path)
    monkeypatch.setattr(models, "ASSETS", [models.Asset("model", asset.url, "0" * 64, asset.files)])
    with pytest.raises(ValueError):
        models.verify_models(tmp_path)
