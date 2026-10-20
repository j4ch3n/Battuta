"""Install the isolated local memory service; never start bots or mutate owner data."""
import argparse
import hashlib
import platform
import struct
import subprocess
from pathlib import Path


def validate_platform(system=None, machine=None, bits=None, libc=None):
    system = system or platform.system()
    machine = machine or platform.machine()
    bits = bits or struct.calcsize("P") * 8
    libc = libc or platform.libc_ver()
    if system == "Darwin" and machine in ("arm64", "x86_64") and bits == 64:
        return
    if system == "Linux" and machine == "aarch64" and bits == 64 and libc[0] == "glibc" and tuple(map(int, libc[1].split(".")[:2])) >= (2, 28):
        return
    raise RuntimeError("Use 64-bit Raspberry Pi OS Bookworm or newer (aarch64/glibc >=2.28), or a supported macOS development host")


def run(args):
    try:
        subprocess.run(args, check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"Memory setup failed at {args[0]}; verify uv, compatible CPython 3.12 wheels, SQLite extension loading and libgomp1/libstdc++6 on Linux. No source compilation or fallback is attempted.") from error


def verify_wheels(folder):
    for line in (folder / "SHA256SUMS").read_text().splitlines():
        expected, name = line.split()
        if Path(name).name != name:
            raise RuntimeError("Invalid wheel manifest")
        with (folder / name).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise RuntimeError("Wheel checksum mismatch")


def setup(root, archive=None):
    validate_platform()
    component = root / "memory-service"
    python = component / ".venv/bin/python"
    wheels = component / "wheels"
    if wheels.exists():
        verify_wheels(wheels)
        if not python.exists():
            run(["uv", "venv", "--managed-python", "--python", "3.12", str(component / ".venv")])
        run(["uv", "pip", "install", "--python", str(python), "--offline", "--no-index", "--find-links", str(wheels), "--require-hashes", "-r", str(component / "requirements.txt")])
        own = list(wheels.glob("battuta_memory-*.whl"))
        if len(own) != 1:
            raise RuntimeError("Expected exactly one Battuta memory wheel")
        run(["uv", "pip", "install", "--python", str(python), "--offline", "--no-index", "--no-deps", str(own[0])])
    else:
        import tomllib
        packages = tomllib.loads((component / "uv.lock").read_text())["package"]
        no_build = [flag for package in packages if package["name"] != "battuta-memory" for flag in ("--no-build-package", package["name"])]
        run(["uv", "sync", "--project", str(component), "--locked", "--no-dev", "--managed-python", "--python", "3.12", *no_build])
    run([str(python), "-c", "import sqlite3, sqlite_vec, onnxruntime, tokenizers; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); c.enable_load_extension(False); c.close(); assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()"])
    cli = component / ".venv/bin/battuta-memory"
    run([str(cli), "model", "install", *(["--archive", str(archive)] if archive else [])])
    run([str(cli), "doctor", "--json"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    try:
        setup(Path(__file__).resolve().parents[1], args.archive)
    except RuntimeError as error:
        parser.exit(1, f"{error}\n")
