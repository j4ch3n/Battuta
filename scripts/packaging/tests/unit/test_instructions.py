"""Install instructions use the exact release assets and digests for each platform."""

import hashlib
from pathlib import Path

import click
import pytest

from battuta_packaging.instructions import render_instructions

ROOT = Path(__file__).resolve().parents[4]
TAG = "v0.3.4"
TOOL_VERSION = "0.3.4+g189e492"
RELEASE_URL = f"https://github.com/j4ch3n/Battuta/releases/download/{TAG}"
PACKAGES = ["battuta_project", "battuta_artifacts", "battuta_memory", "battuta_speech", "battuta_doc", "battuta_bot_setup", "battuta_packaging"]


@pytest.fixture
def release(tmp_path):
    wheels = tmp_path / "wheels"
    wheels.mkdir()
    lines = []
    for package in PACKAGES:
        name = f"{package}-{TOOL_VERSION}-py3-none-any.whl"
        digest = hashlib.sha256(name.encode()).hexdigest()
        lines.append(f"{digest}  {name}")
    (wheels / "python-tools-SHA256SUMS").write_text("\n".join(lines) + "\n")
    archive = tmp_path / f"battuta-{TAG}-oracle-ampere-arm64.tar.gz"
    archive.write_bytes(b"archive bytes")
    return wheels, archive


def render(release, platform):
    wheels, archive = release
    return render_instructions(ROOT, platform, tag=TAG, tool_version=TOOL_VERSION, archive=archive, wheels_dir=wheels)


@pytest.mark.parametrize(
    "platform,expected,absent",
    [
        ("oracle-ampere", PACKAGES, []),
        ("raspberry-pi", [p for p in PACKAGES if p not in ("battuta_memory", "battuta_speech", "battuta_doc")], ["battuta_memory", "battuta_speech", "battuta_doc"]),
    ],
    ids=["oracle-ampere", "raspberry-pi"],
)
def test_each_bundle_lists_only_its_wheels_with_release_links_and_digests(release, platform, expected, absent):
    text = render(release, platform)
    for package in expected:
        name = f"{package}-{TOOL_VERSION}-py3-none-any.whl"
        assert f"{RELEASE_URL}/{name}" in text
        assert hashlib.sha256(name.encode()).hexdigest() in text
    for package in absent:
        assert f"{package}-{TOOL_VERSION}" not in text


@pytest.mark.parametrize("platform", ["oracle-ampere", "raspberry-pi"])
def test_archive_checksum_and_name_match_the_built_archive(release, platform):
    _, archive = release
    text = render(release, platform)
    assert archive.name in text
    assert hashlib.sha256(archive.read_bytes()).hexdigest() in text


def test_missing_wheel_digest_stops_rendering(release):
    wheels, _ = release
    sums = wheels / "python-tools-SHA256SUMS"
    sums.write_text("\n".join(line for line in sums.read_text().splitlines() if "battuta_memory" not in line) + "\n")
    with pytest.raises(click.ClickException, match="Missing wheel digest"):
        render(release, "oracle-ampere")
