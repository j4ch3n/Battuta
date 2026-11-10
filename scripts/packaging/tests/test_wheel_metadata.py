"""Installers must obtain exact runtime requirements from wheel metadata alone."""

from email import message_from_bytes
import hashlib
import base64
import csv
import io
import json
import subprocess
import zipfile

import click
import pytest

from battuta_packaging import wheel_metadata as wheels


def test_release_requirements_pin_closure_and_internal_urls():
    result = wheels.release_requirements('click==8.1.8\ngql[httpx]==4.4.0 ; python_version >= "3.12"\nbattuta-project==0.1\n', release_url="https://github.com/example/repo/releases/download/v1.2.3", tool_version="1.2.3+gabc1234")
    assert "click==8.1.8" in result
    assert any('gql[httpx]==4.4.0' in value and "python_version" in value for value in result)
    assert "battuta-project @ https://github.com/example/repo/releases/download/v1.2.3/battuta_project-1.2.3+gabc1234-py3-none-any.whl" in result


@pytest.mark.parametrize("requirement", ["click>=8", "click", "-e ../source", "thing @ file:///source", "thing @ https://example.com/unknown.whl", "click==8.*"])
def test_unpinned_or_local_requirements_fail(requirement):
    with pytest.raises(click.ClickException):
        wheels.release_requirements(requirement, release_url="https://example.com/v1.2.3", tool_version="1.2.3+gabc1234")


def test_internal_wheel_pin_conflicts_fail_closed():
    with pytest.raises(click.ClickException, match="lockfiles disagree"):
        wheels.check_internal_pins({"battuta-project": ["click==8.1.8"], "battuta-artifacts": ["click==8.2.0", "battuta-project @ https://example.com/project.whl"]})


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
