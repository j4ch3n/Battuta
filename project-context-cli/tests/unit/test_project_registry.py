"""Registry contracts: fixed checkout, validated state, and failure isolation."""

import subprocess
from unittest.mock import patch

import click
import pytest
import yaml

from battuta_project.models import LinearConfig

ATLAS = "https://github.com/team/atlas-api"
HARBOR = "https://github.com/team/harbor-web"


def test_remove_preserves_tree_and_deregisters(registry, clone, home):
    project = registry.init("atlas")
    registry.init("other")
    (project.root / ".hidden").write_text("important")
    external = home / "external"
    external.write_text("untouched")
    (project.root / "link").symlink_to(external)
    trash = home / ".Trash"
    (trash / "atlas").mkdir(parents=True)
    (trash / "atlas" / "existing").write_text("existing")
    clone.side_effect = None
    clone.return_value = subprocess.CompletedProcess([], 0, '{"ok":true,"artifacts_removed":["a"]}', "")
    registry.remove("atlas")
    assert registry.names() == ["other"]
    moved = next(trash.glob("atlas-*/atlas"))
    assert (moved / ".hidden").read_text() == "important"
    assert (moved / "link").is_symlink()
    assert external.read_text() == "untouched"
    assert (trash / "atlas" / "existing").read_text() == "existing"
    with pytest.raises(click.ClickException):
        registry.remove("atlas")


def test_remove_fails_closed_and_reports_partial_state(registry, clone):
    project = registry.init("atlas")
    clone.side_effect = None
    clone.return_value = subprocess.CompletedProcess([], 5, '{"ok":false,"error":{"message":"database unavailable"}}', "")
    with pytest.raises(click.ClickException, match="database unavailable"):
        registry.remove("atlas")
    assert project.root.exists()
    clone.return_value = subprocess.CompletedProcess([], 0, '{"ok":true,"artifacts_removed":["report"]}', "")
    with patch("pathlib.Path.rename", side_effect=OSError("disk failure")), pytest.raises(click.ClickException, match="disk failure.*report"):
        registry.remove("atlas")
    assert project.root.exists()


def test_remove_reports_artifact_process_stderr_when_output_is_not_json(registry, clone):
    project = registry.init("atlas")
    clone.side_effect = None
    clone.return_value = subprocess.CompletedProcess([], 1, "", "artifact process crashed")
    with pytest.raises(click.ClickException, match="artifact process crashed"):
        registry.remove("atlas")
    assert project.root.exists()


def test_loading_projects_preserves_work_files(registry, root):
    registry.init("atlas")
    registry.init("harbor")
    work = root / "atlas/work"
    work.mkdir()
    files = {"todo.jsonl": b"private outcome\n", "note.md": b"private finding\n", "draft.md": b"private draft\n"}
    for name, content in files.items():
        (work / name).write_bytes(content)
    assert registry.load("atlas").name == "atlas"
    assert [p.name for p in registry.list_projects()] == ["atlas", "harbor"]
    assert {p.name: p.read_bytes() for p in work.iterdir()} == files


def test_project_identity_is_derived_from_directory(registry, clone, root):
    project = registry.init("atlas-api", github=f"{ATLAS}.git")
    assert project.name == "atlas-api"
    assert project.code == root / "atlas-api" / "code"
    clone.assert_called_once_with(["gh", "repo", "clone", f"{ATLAS}.git", str(project.code)], check=True)
    assert not (root / ".config.json").exists()
    assert not (root / ".config.lock").exists()
    assert yaml.safe_load((root / "atlas-api" / "project.yaml").read_text()) == {
        "version": 1,
        "linear": {"project_id": None, "team_id": None},
        "github": {"repository": "team/atlas-api"},
    }
    assert registry.load("atlas-api") == project


@pytest.mark.parametrize("url", [
    HARBOR, f"{HARBOR}/", "git@github.com:team/harbor-web.git", "ssh://git@github.com/team/harbor-web.git",
], ids=["https", "trailing-slash", "scp-style", "ssh"])
def test_github_url_variants(registry, url):
    assert registry.init("harbor-web", github=url).config.github.repository == "team/harbor-web"


def test_init_writes_no_summary(registry):
    project = registry.init("atlas-api", github=ATLAS)
    assert sorted(p.name for p in project.root.iterdir()) == ["code", "project.yaml"]


@pytest.mark.parametrize("fields", [
    {}, {"project_id": "project-1"}, {"team_id": "team-1"}, {"project_id": "project-1", "team_id": "team-1"},
], ids=["none", "project-only", "team-only", "both"])
def test_init_records_optional_linear_metadata(registry, root, fields):
    project = registry.init("atlas-api", github=ATLAS, linear=LinearConfig(**fields))
    config = yaml.safe_load((project.root / "project.yaml").read_text())
    assert config["linear"] == {"project_id": fields.get("project_id"), "team_id": fields.get("team_id")}
    assert not (root / ".config.json").exists()


def test_link_updates_captured_project_and_preserves_latest_metadata(registry):
    project = registry.init("atlas-api", github=ATLAS)
    registry.init("harbor-web", github=HARBOR)
    path = project.root / "project.yaml"
    config = yaml.safe_load(path.read_text())
    config["github"]["repository"] = "other/atlas-api"
    path.write_text(yaml.safe_dump(config))
    linked = registry.link_linear(project, LinearConfig(project_id=" project-1 ", team_id=" team-1 "))
    assert linked.config.linear.project_id == "project-1"
    assert yaml.safe_load(path.read_text())["linear"] == {"project_id": "project-1", "team_id": "team-1"}
    assert registry.load("atlas-api").config.github.repository == "other/atlas-api"
    assert registry.load("harbor-web").config.linear.project_id is None
    registry.link_linear(project, LinearConfig(project_id="project-2", team_id="team-2"))
    assert registry.load("atlas-api").config.linear.project_id == "project-2"


def test_failed_link_write_preserves_existing_project_configuration(registry):
    project = registry.init("atlas-api", github=ATLAS)
    path = project.root / "project.yaml"
    original = path.read_text()
    original_files = sorted(p.name for p in project.root.iterdir())
    with patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")), pytest.raises(click.ClickException, match="disk full"):
        registry.link_linear(project, LinearConfig(project_id="project-1", team_id="team-1"))
    assert path.read_text() == original
    assert sorted(p.name for p in project.root.iterdir()) == original_files


@pytest.mark.parametrize("url", [
    "https://gitlab.com/team/repo", "https://github.com/team/repo/tree/main",
    "https://github.com/team/repo?token=secret", "https://github.com/team/..",
    "https://github.com/team/.hidden", "https://github.com/team/a%2Fb",
    "https://github.com/team/repo#readme", "--help", "team/repo",
], ids=["other-host", "subpath", "query", "dotdot", "hidden", "encoded-slash", "fragment", "option-like", "no-host"])
def test_invalid_urls_do_not_create_registry(registry, clone, root, url):
    with pytest.raises(click.ClickException):
        registry.init("linth", github=url)
    assert not root.exists()
    clone.assert_not_called()


def test_load_matches_exact_folder(registry):
    registry.init("atlas-api", github=ATLAS)
    registry.init("harbor-web", github=HARBOR)
    for name in ("atlas", "Atlas-api", "missing", "../atlas-api", ".config.json"):
        with pytest.raises(click.ClickException):
            registry.load(name)
    assert registry.load("atlas-api").name == "atlas-api"


def test_collision_does_not_overwrite_existing_project(registry, clone, root):
    registry.init("atlas-api", github=ATLAS)
    marker = root / "atlas-api" / "code" / "work.txt"
    marker.write_text("uncommitted work")
    with pytest.raises(click.ClickException):
        registry.init("atlas-api", github="https://github.com/other/atlas-api")
    assert marker.read_text() == "uncommitted work"
    assert clone.call_count == 1


@pytest.mark.parametrize("error", [FileNotFoundError("gh"), subprocess.CalledProcessError(1, ["gh"])],
                         ids=["gh-missing", "clone-failed"])
def test_clone_failures_remove_only_new_project(registry, clone, root, error):
    registry.init("atlas-api", github=ATLAS)
    clone.side_effect = error
    with pytest.raises(click.ClickException):
        registry.init("harbor-web", github=HARBOR)
    assert not (root / "harbor-web").exists()
    assert registry.load("atlas-api").name == "atlas-api"


def test_projects_retain_their_own_linear_ids(registry):
    atlas = LinearConfig(project_id="project-1", team_id="team-1")
    harbor = LinearConfig(project_id="project-2", team_id="team-2")
    registry.init("atlas-api", github=ATLAS, linear=atlas)
    registry.init("harbor-web", github=HARBOR, linear=harbor)
    assert registry.load("atlas-api").config.linear == atlas
    assert registry.load("harbor-web").config.linear == harbor


@pytest.mark.parametrize("change", [
    {"version": 2}, {"version": True}, {"github": {"repository": 3}}, {"unexpected": True},
], ids=["wrong-version", "boolean-version", "non-string-repository", "unknown-field"])
def test_invalid_project_config_is_rejected(registry, root, change):
    registry.init("atlas-api", github=ATLAS)
    config = root / "atlas-api" / "project.yaml"
    config.write_text(yaml.safe_dump({**yaml.safe_load(config.read_text()), **change}))
    with pytest.raises(click.ClickException, match="project.yaml"):
        registry.load("atlas-api")


def test_symlink_project_file_cannot_redirect_access(registry, root, home):
    registry.init("atlas-api", github=ATLAS)
    outside = home / "outside"
    outside.write_text("preserve me")
    file = root / "atlas-api" / "project.yaml"
    file.unlink()
    file.symlink_to(outside)
    with pytest.raises(click.ClickException):
        registry.load("atlas-api")
    assert outside.read_text() == "preserve me"


def test_project_and_checkout_symlinks_are_rejected(registry, root, home):
    registry.init("atlas-api", github=ATLAS)
    (root / "alias").symlink_to(root / "atlas-api", target_is_directory=True)
    with pytest.raises(click.ClickException):
        registry.load("alias")
    code = root / "atlas-api" / "code"
    code.rmdir()
    code.symlink_to(home, target_is_directory=True)
    with pytest.raises(click.ClickException):
        registry.load("atlas-api")


@pytest.mark.parametrize("component", ["projects", ".battuta"])
def test_symlink_registry_and_owned_parent_cannot_redirect_operations(registry, home, component):
    project = registry.init("atlas-api", github=ATLAS)
    (project.root / "SUMMARY.md").write_text("Preserve me\n")
    link = registry.root if component == "projects" else registry.root.parent
    outside = home / "external"
    link.rename(outside)
    link.symlink_to(outside, target_is_directory=True)
    for action in (registry.list_projects, lambda: registry.load("atlas-api"), lambda: registry.init("harbor-web", github=HARBOR)):
        with pytest.raises(click.ClickException):
            action()
    redirected_root = outside if component == "projects" else outside / "projects"
    assert (redirected_root / "atlas-api" / "SUMMARY.md").read_text() == "Preserve me\n"
    assert not (redirected_root / "harbor-web").exists()


def test_name_only_initialization_does_not_run_git_or_gh(registry, clone, root):
    project = registry.init("linth")
    clone.assert_not_called()
    assert project.code == root / "linth" / "code"
    assert project.code.is_dir()
    assert yaml.safe_load((project.root / "project.yaml").read_text())["github"] == {"repository": None}
    assert registry.load("linth").name == "linth"
    assert [p.name for p in registry.list_projects()] == ["linth"]


@pytest.mark.parametrize("name", ["", " ", ".", "..", ".hidden", ".config.json", "../outside", "a/b", "a\\b", "a\x00b"],
                         ids=["empty", "space", "dot", "dotdot", "hidden", "config-file", "traversal", "slash", "backslash", "nul"])
def test_invalid_names_are_rejected_before_cloning_or_creating_registry(registry, clone, root, name):
    with pytest.raises(click.ClickException):
        registry.init(name, github="https://github.com/team/other")
    clone.assert_not_called()
    assert not root.exists()
