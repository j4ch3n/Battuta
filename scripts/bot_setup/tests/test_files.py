"""Declared preparation preserves private files and validates before writing."""

import pytest
import click

from bot_setup.files import prepare_files
from bot_setup.manifest import FileRule


def rule(**changes):
    return FileRule.model_validate({
        "operation": "copy",
        "sources": [{"root": "repository", "path": "input.txt"}],
        "target": "output.txt",
        "destination": "private",
        "policy": "create-only",
        **changes,
    })


def test_create_only_preserves_existing_bytes_and_replace_refreshes(tmp_path):
    (tmp_path / "input.txt").write_text("generated")
    private = tmp_path / "private"
    for _ in range(2):
        prepare_files(tmp_path, tmp_path / "profile", private, [rule()])
    assert (private / "output.txt").read_text() == "generated"
    (private / "output.txt").write_text("custom")
    prepare_files(tmp_path, tmp_path / "profile", private, [rule()])
    assert (private / "output.txt").read_text() == "custom"
    prepare_files(tmp_path, tmp_path / "profile", private, [rule(policy="replace")])
    assert (private / "output.txt").read_text() == "generated"
    assert (private / "output.txt").stat().st_mode & 0o777 == 0o600


def test_concatenation_uses_explicit_source_roots(tmp_path):
    profile = tmp_path / "profile"
    profile.mkdir()
    (tmp_path / "input.txt").write_text("shared")
    (profile / "dedicated.md").write_text("dedicated")
    prepare_files(tmp_path, profile, tmp_path / "private", [rule(
        operation="concatenate", destination="profile",
        sources=[{"root": "repository", "path": "input.txt"}, {"root": "profile", "path": "dedicated.md"}],
    )])
    assert (profile / "output.txt").read_text() == "shared\ndedicated"


@pytest.mark.parametrize("bad", ["missing-source", "target-link", "parent-link", "escape"])
def test_all_rules_preflight_before_writes(tmp_path, bad):
    (tmp_path / "input.txt").write_text("generated")
    private = tmp_path / "private"
    private.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    second = rule(target="other.txt")
    if bad == "missing-source":
        second.sources[0].path = "missing.txt"
    elif bad == "target-link":
        (private / "other.txt").symlink_to(outside / "untouched")
    elif bad == "parent-link":
        (private / "nested").symlink_to(outside, target_is_directory=True)
        second.target = "nested/other.txt"
    else:
        second.target = "../outside/untouched"
    with pytest.raises(click.ClickException):
        prepare_files(tmp_path, tmp_path / "profile", private, [rule(), second])
    assert not (private / "output.txt").exists()
    assert not (outside / "untouched").exists()


def test_optional_missing_source_is_skipped(tmp_path):
    prepare_files(tmp_path, tmp_path / "profile", tmp_path / "private", [rule(optional=True)])
    assert not (tmp_path / "private").exists()
