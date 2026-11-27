"""Bundle staging and extraction reject unsafe inputs before writing."""

import io
import tarfile
from types import SimpleNamespace
from unittest.mock import MagicMock

import click
import pytest

from battuta_packaging import bundle


@pytest.fixture
def source(tmp_path, monkeypatch):
    """A source tree whose bot setup boundary returns one selected skill and extension-free manifests."""
    root = tmp_path / "source"
    (root / "skills-hub/research").mkdir(parents=True)
    (root / "skills-hub/research/SKILL.md").write_text("research")
    (root / "docs").mkdir()
    monkeypatch.setattr(bundle, "load_selection", MagicMock(return_value=["research"]))
    monkeypatch.setattr(bundle, "load_profile", MagicMock(return_value=SimpleNamespace(extensions=[], claude=None)))
    monkeypatch.setattr(bundle, "source_extension_links", MagicMock(return_value={}))
    return root


@pytest.mark.parametrize("via_symlink", [False, True], ids=["nonempty", "symlink"])
def test_stage_rejects_nonempty_and_symlink_targets(source, tmp_path, via_symlink):
    target = tmp_path / "release"
    target.mkdir()
    (target / "private").write_text("keep")
    destination = tmp_path / "link" if via_symlink else target
    if via_symlink:
        destination.symlink_to(target)
    with pytest.raises(click.ClickException, match="empty regular directory"):
        bundle.stage_bots(source, destination, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert (target / "private").read_text() == "keep"


@pytest.mark.parametrize("link,message", [("skills-hub/research/escape", "must not be symlinks"), ("docs/escape.md", "must not contain symlinks")], ids=["skill-escape", "doc-symlink"])
def test_source_symlink_escape_fails_before_writing(source, tmp_path, link, message):
    (tmp_path / "private").mkdir()
    (source / link).symlink_to(tmp_path / "private")
    target = tmp_path / "release"
    with pytest.raises(click.ClickException, match=message):
        bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert not target.exists()


@pytest.mark.parametrize("member", ["../escape", "/absolute", "bots/../escape", "other/file"],
                         ids=["parent", "absolute", "nested-parent", "unexpected-root"])
def test_archive_traversal_is_rejected_before_extraction(tmp_path, member):
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        info = tarfile.TarInfo(member)
        info.size = 1
        output.addfile(info, io.BytesIO(b"x"))
    target = tmp_path / "install"
    with pytest.raises(click.ClickException):
        bundle.extract_bundle(archive, target)
    assert not target.exists()


@pytest.mark.parametrize("kind", [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE], ids=["symlink", "hardlink", "fifo"])
def test_documentation_special_members_are_rejected(tmp_path, kind):
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        info = tarfile.TarInfo("docs/unsafe")
        info.type = kind
        info.linkname = "../escape"
        output.addfile(info)
    target = tmp_path / "install"
    with pytest.raises(click.ClickException):
        bundle.extract_bundle(archive, target)
    assert not target.exists()
