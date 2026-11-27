"""A staged wheel builds with the pinned requirements and verifiable RECORD hashes."""

import base64
import csv
from email import message_from_bytes
import hashlib
import io
import subprocess
import zipfile

import pytest

from battuta_packaging import wheel_metadata as wheels

pytestmark = pytest.mark.integration


def test_final_metadata_uses_hook_and_record_hashes(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    original = '[project]\nname="example-tool"\nversion="0.1"\nrequires-python=">=3.12"\ndependencies=["click>=8"]\n[project.scripts]\nexample-tool="example_tool:main"\n[build-system]\nrequires=["hatchling>=1.27,<2"]\nbuild-backend="hatchling.build"\n[tool.hatch.build.targets.wheel]\npackages=["src/example_tool"]\n'
    (source / "pyproject.toml").write_text(original)
    module = source / "src/example_tool"
    module.mkdir(parents=True)
    (module / "__init__.py").write_text("def main(): pass\n")
    stage = tmp_path / "stage"
    wheels.stage_wheel_project(source, stage, requirements=["click==8.1.8"], tool_version="1.2.3+gabc1234")
    subprocess.run(["uv", "build", str(stage), "--wheel", "--out-dir", str(tmp_path / "dist")], check=True, capture_output=True)
    wheel, = (tmp_path / "dist").glob("*.whl")
    with zipfile.ZipFile(wheel) as archive:
        metadata = message_from_bytes(archive.read(next(n for n in archive.namelist() if n.endswith("/METADATA"))))
        assert metadata.get_all("Requires-Dist") == ["click==8.1.8"]
        assert metadata["Version"] == "1.2.3+gabc1234"
        record = archive.read(next(n for n in archive.namelist() if n.endswith("/RECORD"))).decode()
        for name, digest, size in csv.reader(io.StringIO(record)):
            if digest:
                actual = base64.urlsafe_b64encode(hashlib.sha256(archive.read(name)).digest()).decode().rstrip("=")
                assert digest == "sha256=" + actual
    assert (source / "pyproject.toml").read_text() == original
