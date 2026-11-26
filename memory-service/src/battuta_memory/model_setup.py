"""Provision the pinned Qwen3 embedding files, never at server startup."""
import fcntl
import hashlib
import json
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

MODEL = "qwen3-embedding-0.6b-int8"
REPOSITORY = "onnx-community/Qwen3-Embedding-0.6B-ONNX"
REVISION = "c25a394dd583836952667c12f008335071b3f43d"
FILES = {
    "onnx/model_int8.onnx": "6d0ea863f78b4a84afa3c7fcba1ec341572b5e28121aef77b7092b1dfdf679c7",
    "tokenizer.json": "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a",
}
MAX_FILE = 700 * 1024 * 1024
REQUIRED_FREE = 2 * MAX_FILE


def model_folder(home: Path) -> Path:
    return home / ".cache/battuta/models" / MODEL


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_model(home: Path) -> dict:
    folder = model_folder(home)
    try:
        if folder.is_symlink():
            raise ValueError("Symlink model path")
        manifest = json.loads((folder / "battuta-manifest.json").read_text())
        if manifest.get("model") != MODEL or manifest.get("revision") != REVISION or manifest.get("files") != FILES:
            raise ValueError("Wrong model identity")
        for name, digest in FILES.items():
            path = folder / name
            if path.is_symlink() or sha256(path) != digest:
                raise ValueError("Checksum mismatch")
        return manifest
    except (OSError, ValueError) as error:
        raise RuntimeError("Verified embedding model unavailable; run battuta-memory model install") from error


def download(name: str, destination: Path) -> None:
    url = f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}"
    with urllib.request.urlopen(url, timeout=60) as response, destination.open("xb") as output:
        count = 0
        while chunk := response.read(1024 * 1024):
            count += len(chunk)
            if count > MAX_FILE:
                raise RuntimeError("Model file exceeds download size limit")
            output.write(chunk)


def install_model(home: Path, source_dir: Path | None = None) -> dict:
    folder = model_folder(home)
    folder.parent.mkdir(parents=True, exist_ok=True)
    if folder.parent.is_symlink():
        raise RuntimeError("Unsafe symlink model cache")
    with (folder.parent / ".install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if folder.exists():
            try:
                return verify_model(home)
            except RuntimeError as error:
                raise RuntimeError("Unverified existing model cache; move it aside explicitly before model install") from error
        if shutil.disk_usage(folder.parent).free < REQUIRED_FREE:
            raise RuntimeError("Insufficient disk space for model provisioning (1.4 GiB required)")
        with tempfile.TemporaryDirectory(prefix=".battuta-model-", dir=folder.parent) as temp:
            staging = Path(temp) / MODEL
            for name, digest in FILES.items():
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                if source_dir is None:
                    download(name, target)
                else:
                    shutil.copyfile(source_dir / name, target)
                if target.stat().st_size > MAX_FILE or sha256(target) != digest:
                    raise RuntimeError(f"Model file checksum/size mismatch: {name}")
            manifest = {"model": MODEL, "repository": REPOSITORY, "revision": REVISION, "files": FILES}
            (staging / "battuta-manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
            os.rename(staging, folder)
        return verify_model(home)
