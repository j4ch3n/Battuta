"""Fresh release output is complete, fixed, and independent of source paths."""

import json
from pathlib import Path
import shutil

import click
import pytest

from bot_setup.skills import validate_bundle
from battuta_packaging.skills import stage_skills
from battuta_packaging.services import install_services


def selection(root, role, names):
    for name in names:
        source = root / "skills-hub" / name
        (source / "references/nested").mkdir(parents=True, exist_ok=True)
        (source / "SKILL.md").write_text(f"---\nname: {name}\n---\n")
        (source / "references/nested/tools.md").write_text(f"{name} tools")
        (source / "LICENSE").write_text("Required notice")
    bot = root / f"bots/{role}-bot"
    bot.mkdir(parents=True)
    (bot / "skills.json").write_text(json.dumps({"skills": names}))
    return bot


@pytest.mark.parametrize("empty", [False, True])
def test_complete_copies_are_portable_and_preserve_private_state(tmp_path, empty):
    for role in ("pm", "tl"):
        bot = selection(tmp_path, role, [] if empty else ["memory", *(["role-only"] if role == "pm" else [])])
        skills = bot / ".pi/skills"
        skills.mkdir(parents=True)
        (skills / "old").symlink_to("../../../../skills-hub/memory")
        (bot / ".pi/auth.json").write_text("private")
    if empty:
        (tmp_path / "skills-hub").mkdir()
    else:
        (tmp_path / "skills-hub/memory/references/link.md").symlink_to("nested/tools.md")
    stage_skills(tmp_path)
    shutil.rmtree(tmp_path / "skills-hub")
    for role in ("pm", "tl"):
        bot = tmp_path / f"bots/{role}-bot"
        names = validate_bundle(bot)
        assert names == ([] if empty else ["memory", *(["role-only"] if role == "pm" else [])])
        assert (bot / ".pi/auth.json").read_text() == "private"
        for name in names:
            skill = bot / ".pi/skills" / name
            assert (skill / "references/nested/tools.md").read_text() == f"{name} tools"
            assert (skill / "LICENSE").read_text() == "Required notice"
            assert not any(p.is_symlink() for p in skill.rglob("*"))


def test_all_selections_are_preflighted_before_discovery_changes(tmp_path):
    first = selection(tmp_path, "pm", ["memory"])
    second = selection(tmp_path, "tl", ["memory"])
    skills = first / ".pi/skills"
    skills.mkdir(parents=True)
    (skills / "memory").symlink_to("../../../../skills-hub/memory")
    (second / "skills.json").write_text('{"skills":["missing"]}')
    with pytest.raises(click.ClickException):
        stage_skills(tmp_path)
    assert (skills / "memory").is_symlink()


@pytest.mark.parametrize("mutation", ["added", "removed", "missing", "link", "resource-link", "root-link"])
def test_bundle_must_match_manifest_and_have_no_links(tmp_path, mutation):
    bot = selection(tmp_path, "pm", ["memory"])
    selection(tmp_path, "tl", ["memory"])
    stage_skills(tmp_path)
    skills = bot / ".pi/skills"
    if mutation == "added":
        (bot / "skills.json").write_text('{"skills":["memory","absent"]}')
    elif mutation == "removed":
        (bot / "skills.json").write_text('{"skills":[]}')
    elif mutation == "missing":
        (skills / "memory/SKILL.md").unlink()
    elif mutation == "link":
        (skills / "memory").rename(tmp_path / "outside")
        (skills / "memory").symlink_to(tmp_path / "outside")
    elif mutation == "root-link":
        skills.rename(tmp_path / "outside")
        skills.symlink_to(tmp_path / "outside")
    else:
        (skills / "memory/references/link").symlink_to(tmp_path / "skills-hub/memory/SKILL.md")
    with pytest.raises(click.ClickException):
        validate_bundle(bot)


def test_service_installation_preflights_all_owned_units(tmp_path, monkeypatch):
    root = tmp_path / "release"
    config = tmp_path / "config"
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config))
    install_services(root)
    units = config / "systemd/user"
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    install_services(root)
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
    assert len(before) == 4
    changed = units / "battuta-tl.service"
    changed.write_text("custom")
    with pytest.raises(click.ClickException):
        install_services(root)
    assert changed.read_text() == "custom"
    assert (units / "battuta-pm.service").read_bytes() == before["battuta-pm.service"]
