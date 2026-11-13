"""Build-owned resources must be complete, private-free and relocatable."""

import json
import io
import tarfile
import tomllib
from pathlib import Path

import click
import pytest

from battuta_packaging import bundle
from skill_fixtures import manifest_text


@pytest.fixture
def source(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    (root / ".node-version").write_text("24.21.0\n")
    (root / "LICENSE").write_text("repository license")
    (root / "RELEASE.md").write_text("[Setup](docs/setup.md)")
    (root / "docs").mkdir()
    (root / "docs/setup.md").write_text("setup")
    for name in ("skills-hub/project-management/references/installation.md", "skills-hub/project-management/references/commands.md", "skills-hub/project-management/SKILL.md", ".agents/skills/battuta-setup/references/development.md", ".agents/skills/battuta-verify/references/checks.md", "memory-service/DESIGN.md"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("guide")
    (root / "package.json").write_text('{"packageManager":"pnpm@10.20.0"}')
    (root / "bots").mkdir()
    (root / "bots/AGENTS_shared.md").write_text("shared")
    for name in ("agent-mail", "project-spec", "memory-client", "bots/cos-bot", "bots/manager-bot", "assignment-worker"):
        path = root / name
        path.mkdir(parents=True, exist_ok=True)
        (path / "package.json").write_text('{"type":"module","dependencies":{}}')
        (path / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (path / "index.ts").write_text("export default () => {}")
    (root / "memory-client/dream-extension.ts").write_text("export default () => {}")
    for profile in ("cos-bot", "manager-bot", "worker"):
        path = root / "bots" / profile
        path.mkdir(parents=True, exist_ok=True)
        (path / "AGENTS_dedicated.md").write_text(profile)
        (path / "bot.toml").write_text(manifest_text(profile.removesuffix("-bot"), ["research"]))
        (path / ".pi").mkdir()
        (path / ".pi/auth.json").write_text("private-sentinel")
        (path / ".pi/settings.json").write_text('{"defaultModel":"private-model"}')
        (path / ".pi/web-search.json").write_text("{}")
        if profile == "worker":
            (path / "agents").mkdir()
            (path / "agents/researcher.md").write_text("---\nname: researcher\n---\nResearch fixture")
            (path / "agents/reviewer.md").write_text("---\nname: reviewer\n---\nReview fixture")
            (path / "agents/unselected.md").write_text("Not selected")
    skill = root / "skills-hub/research"
    skill.mkdir(parents=True)
    for name in ("SKILL.md", "LICENSE", "tools.md"):
        (skill / name).write_text(name)
    # The package boundary returns selections; packaging owns copying and validation.
    monkeypatch.setattr(bundle, "load_selection", lambda manifest, catalog: ["research"])
    monkeypatch.setattr(bundle.subprocess, "check_output", lambda *args, **kwargs: "a" * 40)
    def compile_fixture(source, destination):
        outputs = list(bundle.ENTRY_OUTPUTS)
        for profile in bundle.PROFILES:
            entries = json.loads((destination / "bots" / profile / ".pi/extension-build.json").read_text())
            outputs.extend(f"bots/{profile}/.pi/extensions/{entry['name']}/dist/index.js" for entry in entries)
        for relative in outputs:
            path = destination / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export default function () {}")
    monkeypatch.setattr(bundle, "compile_bots", compile_fixture)
    return root


def test_staged_archive_separates_documentation_and_bots(source, tmp_path):
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert (target / "RELEASE.md").is_file()
    assert (target / "docs/setup.md").read_text() == "setup"
    assert not (target / "skills-hub").exists()
    assert (target / ".agents/skills/battuta-setup/references/development.md").is_file()
    assert (target / "memory-service/DESIGN.md").is_file()
    assert (target / "bots/LICENSE").read_text() == "repository license"
    assert not list((target / "bots").rglob("skills-hub"))
    for profile in ("cos-bot", "manager-bot", "worker"):
        bot = target / "bots" / profile
        assert (bot / "AGENTS.md").is_file()
        assert (bot / ".pi/skills/research/LICENSE").read_text() == "LICENSE"
        assert not (bot / ".pi/auth.json").exists()
        settings = json.loads((bot / ".pi/settings.json").read_text())
        assert "extensions" not in settings
        entries = tomllib.loads((bot / "bot.toml").read_text())["extensions"]
        assert {entry.name for entry in (bot / ".pi/extensions").iterdir()} == {entry["name"] for entry in entries}
        for entry in entries:
            package = bot / ".pi/extensions" / entry["name"]
            assert (package / "dist/index.js").is_file()
            assert json.loads((package / "package.json").read_text())["pi"]["extensions"] == ["dist/index.js"]
        assert "defaultModel" not in settings
        assert "skills-hub" not in json.dumps(settings)
        assert not (bot / ".pi/skills/research").is_symlink()
        assert (bot / ".pi/skills/research/SKILL.md").read_text() == "SKILL.md"
        if profile == "manager-bot":
            assert not any("pi-subagents" in package for package in settings["packages"])
        if profile == "worker":
            assert "npm:@tintinweb/pi-subagents@0.24.0" in settings["packages"]
            researcher = (bot / ".pi/agents/researcher.md").read_text()
            reviewer = (bot / ".pi/agents/reviewer.md").read_text()
            assert 'skills: ["research"]' in researcher
            assert 'extensions: ["pi-web-access"]' in researcher
            assert "skills: false" in reviewer
            assert "extensions: false" in reviewer
            assert not (bot / ".pi/agents/unselected.md").exists()
        assert any("pi-browser-use" in package for package in settings["packages"]) == (profile != "manager-bot")
        if profile != "manager-bot":
            assert settings["pi-browser-use"]["headless"] is True
            assert "userDataDir" not in settings["pi-browser-use"]
    assert not list(target.rglob("*.ts"))
    assert not list(target.rglob("node_modules"))
    assert not list(target.rglob("extension-build.json"))
    moved = tmp_path / "relocated"
    target.rename(moved)
    bundle.validate_bundle(moved)
    (moved / "bots/worker/.pi/skills/research/SKILL.md").unlink()
    with pytest.raises(click.ClickException):
        bundle.validate_bundle(moved)


def test_missing_built_extension_is_rejected(source, tmp_path):
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    (target / "bots/worker/.pi/extensions/assignment-worker/dist/index.js").unlink()
    with pytest.raises(click.ClickException):
        bundle.validate_bundle(target)


def test_extracts_only_bots_from_archive_with_documentation(source, tmp_path):
    staged = tmp_path / "staged"
    bundle.stage_bots(source, staged, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        for path in staged.iterdir():
            output.add(path, arcname=path.name)
    target = tmp_path / "install"
    bundle.extract_bundle(archive, target)
    assert (target / "bots/release.json").is_file()
    assert {path.name for path in target.iterdir()} == {"bots"}
    assert not list((target / "bots").rglob("skills-hub"))


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


def test_documentation_symlink_is_rejected(source, tmp_path):
    (source / "docs/escape.md").symlink_to(tmp_path / "private")
    target = tmp_path / "release"
    with pytest.raises(click.ClickException):
        bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert not target.exists()


@pytest.mark.parametrize("member", ["../escape", "/absolute", "bots/../escape", "other/file"])
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


@pytest.mark.parametrize("kind", [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE])
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
