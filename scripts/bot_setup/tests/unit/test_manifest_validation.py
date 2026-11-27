"""Manifest validation uses strict data and the actual staged index."""

import json
from pathlib import Path

import click
import pytest

from bot_setup import skills
from skill_fixtures import manifest_catalog


@pytest.mark.parametrize("text", ["{", "null", "[]", "", '[skills]\ninclude=[]\nrole="cos"', '[skills]\ninclude="research"', '[skills]\ninclude=[1]', '[skills]\ninclude=["research","research"]', '[skills]\ninclude=["missing"]', '[skills]\ninclude=["../research"]', '[skills]\ninclude=["/research"]', '[skills]\ninclude=["Research"]'],
                         ids=["unclosed-brace", "null", "array", "empty", "unknown-key", "include-string", "include-integer", "duplicate-name", "missing-skill", "parent-path", "absolute-path", "uppercase-name"])
def test_invalid_manifest_is_rejected(tmp_path, text):
    hub, manifest = manifest_catalog(tmp_path)
    manifest.write_text(text)
    with pytest.raises(click.ClickException):
        skills.load_selection(manifest, hub)


@pytest.mark.parametrize("names", [["note-taking", "research"], []], ids=["two-in-order", "empty"])
def test_selection_preserves_order_and_accepts_empty(tmp_path, names):
    hub, manifest = manifest_catalog(tmp_path)
    manifest.write_text("[skills]\ninclude = " + json.dumps(names))
    assert skills.load_selection(manifest, hub) == names


def test_escaping_or_missing_entry_is_rejected(tmp_path):
    hub, manifest = manifest_catalog(tmp_path)
    entry = hub / "research/SKILL.md"
    entry.unlink()
    with pytest.raises(click.ClickException):
        skills.load_selection(manifest, hub)
    outside = tmp_path / "outside.md"
    outside.write_text("outside")
    entry.symlink_to(outside)
    with pytest.raises(click.ClickException):
        skills.load_selection(manifest, hub)


def test_all_profiles_include_worker(tmp_path):
    manifest_catalog(tmp_path)
    skills.check_manifests(tmp_path)
    worker = tmp_path / "bots/worker/bot.toml"
    worker.parent.mkdir()
    worker.write_text('[skills]\ninclude=["missing"]')
    with pytest.raises(click.ClickException):
        skills.check_manifests(tmp_path)


@pytest.mark.parametrize("role,outbound,peer", [
    ("cos", "communicate-with-manager", "communicate-with-cos"),
    ("manager", "communicate-with-cos", "communicate-with-manager"),
])
def test_communication_profiles_select_only_their_outbound_skill(role, outbound, peer):
    root = Path(__file__).parents[4]
    selected = skills.load_selection(root / f"bots/{role}-bot/bot.toml", root / "skills-hub")
    assert outbound in selected
    assert peer not in selected
