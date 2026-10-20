"""Provision the pinned architecture-independent ONNX archive, never at server startup."""
import fcntl
import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath
from .config import MODEL, DIMENSION

ARCHIVE_URL = "https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz"
ARCHIVE_SHA256 = "913d7300ceae3b2dbc2c50d1de4baacab4be7b9380491c27fab7418616a16ec3"
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXTRACTED = 512 * 1024 * 1024


def model_folder(home):
    return home / ".cache/mcp_memory/onnx_models" / MODEL / "onnx"


def cache_paths(home, folder):
    current = home
    for part in folder.relative_to(home).parts:
        current = current / part
        yield current


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_model(home: Path):
    folder = model_folder(home)
    try:
        if any(p.is_symlink() for p in cache_paths(home, folder)):
            raise ValueError("Symlink model path")
        manifest = json.loads((folder / "battuta-manifest.json").read_text())
        if manifest["model"] != MODEL or manifest["dimension"] != DIMENSION or manifest["archive_sha256"] != ARCHIVE_SHA256 or manifest["provider"] != "CPUExecutionProvider":
            raise ValueError("Wrong model identity")
        for name in ("model.onnx", "tokenizer.json"):
            path = folder / name
            if path.is_symlink() or sha256(path) != manifest["files"][name]:
                raise ValueError("Checksum mismatch")
        return manifest
    except (OSError, ValueError, KeyError) as error:
        raise RuntimeError("Verified ONNX model unavailable; run battuta-memory model install") from error


def download(destination):
    with urllib.request.urlopen(ARCHIVE_URL, timeout=60) as response, destination.open("xb") as output:
        count = 0
        while chunk := response.read(1024 * 1024):
            count += len(chunk)
            if count > MAX_ARCHIVE:
                raise RuntimeError("Model archive exceeds download size limit")
            output.write(chunk)


def install_model(archive: Path | None, home: Path):
    folder = model_folder(home)
    for path in cache_paths(home, folder.parent):
        if path.is_symlink():
            raise RuntimeError("Unsafe symlink model cache")
        path.mkdir(exist_ok=True)
    if (folder.parent / ".install.lock").is_symlink():
        raise RuntimeError("Unsafe symlink model lock")
    with (folder.parent / ".install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if folder.exists():
            try:
                return verify_model(home)
            except RuntimeError as error:
                raise RuntimeError("Unverified existing model cache; move it aside explicitly before model install") from error
        if shutil.disk_usage(folder.parent).free < MAX_EXTRACTED + MAX_ARCHIVE:
            raise RuntimeError("Insufficient disk space for model provisioning (640 MiB required)")
        with tempfile.TemporaryDirectory(prefix=".battuta-model-", dir=folder.parent) as temp:
            staging = Path(temp)
            if archive is None:
                archive = staging / "model.tar.gz"
                download(archive)
            if archive.stat().st_size > MAX_ARCHIVE or sha256(archive) != ARCHIVE_SHA256:
                raise RuntimeError("Model archive checksum/size mismatch")
            total = 0
            with tarfile.open(archive, "r:gz") as tar:
                for member in tar:
                    name = PurePosixPath(member.name)
                    total += member.size
                    if name.is_absolute() or ".." in name.parts or not name.parts or name.parts[0] != "onnx" or not (member.isfile() or member.isdir()) or total > MAX_EXTRACTED:
                        raise RuntimeError("Unsafe model archive entry")
                    tar.extract(member, staging, filter="data")
            extracted = staging / "onnx"
            files = {name: sha256(extracted / name) for name in ("model.onnx", "tokenizer.json")}
            manifest = {"model": MODEL, "dimension": DIMENSION, "provider": "CPUExecutionProvider", "archive_sha256": ARCHIVE_SHA256,
                "preprocessing": "MiniLM-tokenizer-256-mean-pooling-l2", "files": files}
            manifest["fingerprint"] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
            (extracted / "battuta-manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
            os.rename(extracted, folder)
            return verify_model(home)
