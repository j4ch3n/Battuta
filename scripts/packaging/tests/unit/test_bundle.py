"""Build-owned resources must be complete, private-free and relocatable."""

import json
import io
import tarfile
import tomllib
from pathlib import Path

import click
import pytest

from battuta_packaging import bundle
from skill_fixtures import manifest_text, write_delegate_templates


@pytest.fixture
def source(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    (root / ".node-version").write_text("24.21.0\n")
    (root / "LICENSE").write_text("repository license")
    (root / "RELEASE.md").write_text("[Setup](docs/setup.md)")
    (root / "docs").mkdir()
    (root / "docs/setup.md").write_text("setup")
    for name in ("skills-hub/project-management/references/installation.md", "skills-hub/project-management/references/commands.md", "skills-hub/project-management/SKILL.md", ".agents/skills/battuta-setup/references/development.md", ".agents/skills/battuta-verify/references/checks.md", "memory-service/README.md"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("guide")
    (root / "package.json").write_text('{"packageManager":"pnpm@10.20.0"}')
    catalog = root / "supabase/functions/assignments/abilities.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}")
    (root / "bots").mkdir()
    (root / "bots/AGENTS_shared.md").write_text("shared")
    for name in ("agent-mail", "project-spec", "memory-client", "bots/cos-bot", "bots/manager-bot", "assignment-worker"):
        path = root / name
        path.mkdir(parents=True, exist_ok=True)
        (path / "package.json").write_text('{"type":"module","dependencies":{}}')
        (path / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (path / "index.ts").write_text("export default () => {}")
    (root / "memory-client/dream-extension.ts").write_text("export default () => {}")
    for profile in ("cos-bot", "manager-bot", "worker", "worker-influencer"):
        path = root / "bots" / profile
        path.mkdir(parents=True, exist_ok=True)
        (path / "AGENTS_dedicated.md").write_text(profile)
        if profile == "worker-influencer":
            manifest = (Path(__file__).resolve().parents[4] / "bots/worker-influencer/bot.toml").read_text().split("[skills]")[0] + '[skills]\ninclude = ["research"]'
        else:
            manifest = manifest_text(profile.removesuffix("-bot"), ["research"])
        (path / "bot.toml").write_text(manifest)
        (path / ".pi").mkdir()
        (path / ".pi/auth.json").write_text("private-sentinel")
        (path / ".pi/settings.json").write_text('{"defaultModel":"private-model"}')
        (path / ".pi/web-search.json").write_text("{}")
        if profile == "cos-bot":
            (path / ".pi/telegram.json").write_text("{}")
        if profile == "worker":
            (path / ".pi/mcp.json").write_text("{}")
            write_delegate_templates(path)
    skill = root / "skills-hub/research"
    skill.mkdir(parents=True)
    for name in ("SKILL.md", "LICENSE", "tools.md"):
        (skill / name).write_text(name)
    (root / "skills-hub/read-documents").mkdir()
    (root / "skills-hub/read-documents/SKILL.md").write_text("claude only")
    # The package boundary returns selections; packaging owns copying and validation.
    monkeypatch.setattr(bundle, "load_selection", lambda manifest, catalog: ["research"])
    monkeypatch.setattr(bundle.subprocess, "check_output", lambda *args, **kwargs: "a" * 40)
    def compile_fixture(source, destination):
        outputs = list(bundle.ENTRY_OUTPUTS)
        for profile in bundle.PROFILES:
            entries = json.loads((destination / "bots" / profile / ".pi/extension-build.json").read_text())
            outputs.extend(f"bots/{profile}/.pi/extensions/{entry['name']}/dist/index.js" for entry in entries)
            outputs.extend(
                f"bots/{profile}/.pi/extensions/assignment-worker/dist/claude-proxy.js"
                for entry in entries
                if entry["name"] == "assignment-worker"
            )
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
    assert (target / "memory-service/README.md").is_file()
    assert (target / "bots/LICENSE").read_text() == "repository license"
    assert not list((target / "bots").rglob("skills-hub"))
    for profile in ("cos-bot", "manager-bot", "worker", "worker-influencer"):
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
        assert not any("pi-subagents" in package for package in settings["packages"])
        if profile == "worker":
            assert json.loads((bot / "abilities.json").read_text()) == json.loads(
                (source / "supabase/functions/assignments/abilities.json").read_text()
            )
            assert not (bot / ".pi/agents").exists()
        assert any("pi-browser-use" in package for package in settings["packages"]) == (profile not in ("manager-bot", "worker-influencer"))
        if profile not in ("manager-bot", "worker-influencer"):
            assert settings["pi-browser-use"]["headless"] is True
            assert "userDataDir" not in settings["pi-browser-use"]
        else:
            assert "pi-browser-use" not in settings
    assert not list(target.rglob("*.ts"))
    assert not list(target.rglob("node_modules"))
    assert not list(target.rglob("extension-build.json"))
    moved = tmp_path / "relocated"
    target.rename(moved)
    bundle.validate_bundle(moved)
    (moved / "bots/worker/.pi/skills/research/SKILL.md").unlink()
    with pytest.raises(click.ClickException):
        bundle.validate_bundle(moved)


def test_release_ships_private_templates_declared_in_manifests(source, tmp_path):
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert (target / "bots/cos-bot/.pi/telegram.json").is_file()
    assert (target / "bots/cos-bot/.pi/web-search.json").is_file()
    assert (target / "bots/worker/.pi/mcp.json").is_file()
    assert not (target / "bots/manager-bot/.pi/telegram.json").exists()
    assert not (target / "bots/worker-influencer/.pi/mcp.json").exists()


def test_stage_rejects_missing_required_private_template(source, tmp_path):
    (source / "bots/cos-bot/.pi/telegram.json").unlink()
    with pytest.raises(click.ClickException):
        bundle.stage_bots(source, tmp_path / "release", tag="v1.2.3", tool_version="1.2.3+gabc1234")


def test_bundled_workspace_dependencies_are_not_installed_at_runtime(source, tmp_path):
    manifest_path = source / "assignment-worker/package.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["dependencies"] = {"@battuta/agent-mail": "workspace:*", "typebox": "1.3.27"}
    manifest_path.write_text(json.dumps(manifest))
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    for path in (
        target / "bots/worker/package.json",
        target / "bots/worker/.pi/extensions/assignment-worker/package.json",
    ):
        assert json.loads(path.read_text())["dependencies"] == {"typebox": "1.3.27"}


def test_memory_release_retains_workspace_overrides(source, tmp_path):
    root_manifest = source / "package.json"
    data = json.loads(root_manifest.read_text())
    data["pnpm"] = {"overrides": {"example": "1.2.3"}}
    root_manifest.write_text(json.dumps(data))
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    paths = [target / "bots/_shared/memory-client/package.json"]
    paths.extend(
        package / "package.json"
        for package in (target / "bots/cos-bot/.pi/extensions").iterdir()
        if json.loads((package / "package.json").read_text()).get("pnpm")
    )
    assert paths
    for path in paths:
        assert json.loads(path.read_text())["pnpm"]["overrides"] == {"example": "1.2.3"}


@pytest.mark.parametrize("profile", ["worker", "worker-influencer"])
def test_worker_releases_ship_the_claude_proxy(source, tmp_path, profile):
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    assert (target / f"bots/{profile}/.pi/extensions/assignment-worker/dist/claude-proxy.js").is_file()


@pytest.mark.parametrize("missing", ["claude-proxy.js", "index.js"], ids=["worker-proxy", "built-extension"])
def test_missing_worker_build_output_is_rejected(source, tmp_path, missing):
    target = tmp_path / "release"
    bundle.stage_bots(source, target, tag="v1.2.3", tool_version="1.2.3+gabc1234")
    (target / "bots/worker/.pi/extensions/assignment-worker/dist" / missing).unlink()
    with pytest.raises(click.ClickException) as error:
        bundle.validate_bundle(target)
    assert missing in str(error.value.__cause__)


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
