"""Build-owned resources must be complete, private-free and relocatable."""

import json
from pathlib import Path

import click
import pytest

from battuta_packaging import bundle


@pytest.fixture
def source(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    (root / ".node-version").write_text("24.21.0\n")
    (root / "package.json").write_text('{"packageManager":"pnpm@10.20.0"}')
    (root / "bots").mkdir()
    (root / "bots/AGENTS_shared.md").write_text("shared")
    for name in ("agent-mail", "project-spec", "memory-client", "bots/cos-bot", "bots/manager-bot", "bots/worker/extension/assignment-worker"):
        path = root / name
        path.mkdir(parents=True, exist_ok=True)
        (path / "package.json").write_text('{"type":"module","dependencies":{}}')
        (path / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
    for profile in ("cos-bot", "manager-bot", "worker"):
        path = root / "bots" / profile
        (path / "AGENTS_dedicated.md").write_text(profile)
        (path / "skills.json").write_text('{"skills":["research"]}')
        (path / ".pi").mkdir()
        (path / ".pi/auth.json").write_text("private-sentinel")
        (path / ".pi/settings.json").write_text('{"defaultModel":"private-model"}')
    skill = root / "skills-hub/research"
    skill.mkdir(parents=True)
    for name in ("SKILL.md", "LICENSE", "tools.md"):
        (skill / name).write_text(name)
    # The package boundary returns selections; packaging owns copying and validation.
    monkeypatch.setattr(bundle, "load_selection", lambda manifest, catalog: ["research"])
    monkeypatch.setattr(bundle.subprocess, "check_output", lambda *args, **kwargs: "a" * 40)
    monkeypatch.setattr(bundle, "compile_bots", lambda source, destination: [
        (destination / relative).write_text("export default function () {}")
        for relative in bundle.ENTRY_OUTPUTS
    ])
    return root


def test_staged_archive_is_bot_only(source, tmp_path):
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert {p.name for p in target.iterdir()} == {"bots"}
    for profile in ("cos-bot", "manager-bot", "worker"):
        bot = target / "bots" / profile
        assert (bot / "AGENTS.md").is_file()
        assert (bot / ".pi/skills/research/LICENSE").read_text() == "LICENSE"
        assert not (bot / ".pi/auth.json").exists()
        assert "defaultModel" not in json.loads((bot / ".pi/settings.json").read_text())
    assert not list(target.rglob("*.ts"))
    assert not list(target.rglob("node_modules"))
    moved = tmp_path / "relocated"
    target.rename(moved)
    bundle.validate_bundle(moved)
    (moved / "bots/worker/.pi/skills/research/SKILL.md").unlink()
    with pytest.raises(click.ClickException):
        bundle.validate_bundle(moved)


def test_stage_rejects_nonempty_and_symlink_targets(source, tmp_path):
    target = tmp_path / "release"
    target.mkdir()
    (target / "private").write_text("keep")
    for path in (target, tmp_path / "link"):
        if path != target:
            path.symlink_to(target)
        with pytest.raises(click.ClickException):
            bundle.stage_bots(source, path, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert (target / "private").read_text() == "keep"


def test_skill_escape_fails_before_writing(source, tmp_path):
    (source / "skills-hub/research/escape").symlink_to(tmp_path)
    target = tmp_path / "release"
    with pytest.raises(click.ClickException):
        bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert not target.exists()
