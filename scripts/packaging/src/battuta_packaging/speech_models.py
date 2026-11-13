"""Provision pinned speech assets during release setup."""

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
from urllib.request import urlopen


@dataclass(frozen=True)
class Asset:
    name: str
    url: str
    sha256: str
    files: tuple[str, ...]
    raw: bool = False


ASSETS = [
    Asset(
        "sensevoice",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e",
        ("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/tokens.txt"),
    ),
    Asset(
        "pocket",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2",
        "2f3b88823cbbb9bf0b2477ec8ae7b3fec417b3a87b6bb5f256dba66f2ad967cb",
        tuple(f"sherpa-onnx-pocket-tts-int8-2026-01-26/{name}" for name in ("lm_flow.int8.onnx", "lm_main.int8.onnx", "encoder.onnx", "decoder.int8.onnx", "text_conditioner.onnx", "vocab.json", "token_scores.json")),
    ),
    Asset(
        "voice",
        "https://huggingface.co/kyutai/tts-voices/resolve/88a3419b6b950493d4eb4aaf8791ff24b6ccb1e9/alba-mackenna/casual.wav",
        "46264e83cb99115c3d210260e029117566d9c64f20266d10daa78107759ede3e",
        ("voice.wav",),
        raw=True,
    ),
]


def download(url: str, target: Path) -> None:
    with urlopen(url, timeout=60) as source, target.open("wb") as output:
        shutil.copyfileobj(source, output)


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify_models(home: Path) -> None:
    root = home / ".battuta/speech-service"
    if root.parent.is_symlink() or root.is_symlink():
        raise ValueError("Speech directory must not use symlinks")
    try:
        metadata = json.loads((root / "manifest.json").read_text())
        if metadata["sources"] != {asset.name: asset.sha256 for asset in ASSETS}:
            raise ValueError("Installed speech assets belong to a different release")
        manifest = metadata["files"]
        expected = {file for asset in ASSETS for file in asset.files}
        if set(manifest) != expected:
            raise ValueError("Model manifest does not match configured assets")
        for name in expected:
            path = root / name
            if path.is_symlink() or not path.is_file() or digest(path) != manifest[name]:
                raise ValueError(f"Invalid speech asset: {name}")
    except (OSError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise ValueError("Speech assets missing or invalid; provision them first") from error


def install_models(home: Path) -> None:
    root = home / ".battuta/speech-service"
    if root.parent.is_symlink():
        raise ValueError("Speech directory must not use symlinks")
    if root.exists() or root.is_symlink():
        if root.is_symlink():
            raise ValueError("Speech directory must not be a symlink")
        verify_models(home)
        return
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix=".speech-", dir=root.parent) as temporary:
        stage = Path(temporary) / "assets"
        stage.mkdir(mode=0o700)
        manifest = {}
        for asset in ASSETS:
            archive = Path(temporary) / asset.name
            download(asset.url, archive)
            if digest(archive) != asset.sha256:
                raise ValueError(f"Checksum mismatch: {asset.name}")
            if asset.raw:
                target = stage / asset.files[0]
                shutil.copyfile(archive, target)
                manifest[asset.files[0]] = digest(target)
                continue
            with tarfile.open(archive, "r:bz2") as tar:
                for member in tar:
                    path = PurePosixPath(member.name)
                    if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                        raise ValueError("Unsafe model archive")
                    if member.name in asset.files:
                        if not member.isfile():
                            raise ValueError("Invalid model asset")
                        target = stage / member.name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        source = tar.extractfile(member)
                        if source is None:
                            raise ValueError("Invalid model asset")
                        with source, target.open("xb") as output:
                            shutil.copyfileobj(source, output)
                        manifest[member.name] = digest(target)
            if not set(asset.files).issubset(manifest):
                raise ValueError(f"Missing files in {asset.name}")
        (stage / "manifest.json").write_text(json.dumps({"sources": {asset.name: asset.sha256 for asset in ASSETS}, "files": manifest}))
        stage.rename(root)
