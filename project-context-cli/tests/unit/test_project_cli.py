"""CLI argument contracts and explicit-project workflows."""

import shlex
from unittest.mock import patch

import pytest
import yaml

from battuta_project.cli import main

CREATE = ["linear", "create", "atlas-api", "Atlas", "--team-id", "team-1"]
EXACT_NAMES = pytest.mark.parametrize(
    "name", ["My 项目", "owner's $(printf injected); &", "-atlas"], ids=["unicode", "shell-metacharacters", "leading-dash"],
)


@pytest.fixture
def config_path(project):
    return project.root / "project.yaml"


@pytest.mark.parametrize("name", ["../other", "missing"], ids=["traversal", "unknown"])
def test_remove_rejects_unsafe_or_unknown_project_before_artifact_access(runner, project, clone, name):
    clone.reset_mock()
    result = runner.invoke(main, ["remove", name])
    assert result.exit_code != 0
    clone.assert_not_called()
    assert project.root.exists()


def test_init_reports_explicit_next_command_without_selection(invoke):
    output = invoke("init", "harbor-web", "--github", "https://github.com/team/harbor-web")
    assert "Initialized project: harbor-web" in output
    assert "~/.battuta/projects/harbor-web/code" in output


@EXACT_NAMES
def test_init_suggests_executable_command_for_exact_name(invoke, name):
    output = invoke("init", "--", name)
    command = next(line.removeprefix("Next: ") for line in output.splitlines() if line.startswith("Next: "))
    arguments = shlex.split(command)
    assert arguments == ["battuta-project", "explain", "--", name]
    assert f".battuta/projects/{name}/code" in invoke(*arguments[1:])


def test_explain_requires_project_argument(runner, invoke, project_file):
    project_file("README.md")
    assert "Project Root: ~/.battuta/projects/atlas-api/code" in invoke("explain", "atlas-api")
    assert runner.invoke(main, ["explain"]).exit_code != 0


def test_explain_prints_repository_and_unlinked_linear_without_http(invoke, project, linear_http):
    with linear_http() as requests:
        output = invoke("explain", "atlas-api")
    assert "Repository URL: https://github.com/team/atlas-api" in output
    assert "Linear Project URL: not linked" in output
    assert requests == []


def test_explain_fetches_linked_linear_url_without_changing_local_state(invoke, config_path, linear_http, linear_project, payload):
    invoke("linear", "link", "atlas-api", "project-1,team-1")
    original = config_path.read_text()
    with linear_http(linear_project) as requests:
        output = invoke("explain", "atlas-api")
    assert "Repository URL: https://github.com/team/atlas-api" in output
    assert "Linear Project URL: https://linear.app/team/project/atlas" in output
    assert "Project Root: ~/.battuta/projects/atlas-api/code" in output
    assert len(requests) == 1
    assert payload(requests[0])["variables"] == {"id": "project-1"}
    assert config_path.read_text() == original


@pytest.mark.parametrize("response, message", [
    ({"errors": [{"message": "Not authenticated"}]}, "Not authenticated"),
    ({"data": {"project": None}}, "Linear project"),
], ids=["api-error", "project-missing"])
def test_explain_reports_lookup_failure_without_rendering_misleading_url(runner, invoke, project, linear_http, response, message):
    invoke("linear", "link", "atlas-api", "project-1,team-1")
    with linear_http(response):
        result = runner.invoke(main, ["explain", "atlas-api"])
    assert result.exit_code != 0
    assert message in result.output
    assert "Linear Project URL:" not in result.output


@pytest.mark.parametrize("target", [None, "missing", "../atlas-api", ".hidden"],
                         ids=["omitted", "unknown", "traversal", "hidden"])
@pytest.mark.parametrize("command, trailing", [
    (["explain"], []),
    (["github", "link"], ["https://github.com/team/other"]),
    (["linear", "link"], ["project-1,team-1"]),
    (["linear", "create"], ["Atlas", "--team-id", "team-1"]),
], ids=["explain", "github-link", "linear-link", "linear-create"])
def test_project_arguments_reject_missing_unknown_or_unsafe_targets_before_http(runner, project, linear_http, target, command, trailing):
    args = command + ([target] if target is not None else []) + trailing
    with linear_http() as requests:
        result = runner.invoke(main, args)
    assert result.exit_code != 0
    assert "Error:" in result.output
    assert requests == []


@pytest.mark.parametrize("value", [None, "", " \t\n"], ids=["unset", "empty", "blank"])
@pytest.mark.parametrize("args", [
    (), ("--help",), ("init", "--help"), ("linear", "--help"), ("linear", "create", "--help"),
    ("list",), ("explain", "atlas-api"), ("init", "harbor-web"),
    ("github", "link", "atlas-api", "https://github.com/team/harbor-web"),
    ("linear", "link", "atlas-api", "project-1,team-1"),
    ("linear", "create", "atlas-api", "Atlas", "--team-id", "team-1"), ("unknown",),
], ids=lambda args: " ".join(args) or "no-args")
def test_all_invocations_require_token_before_any_side_effect(runner, project, registry, config_path, linear_http, monkeypatch, value, args):
    original = config_path.read_bytes()
    monkeypatch.delenv("LINEAR_API_TOKEN")
    if value is not None:
        monkeypatch.setenv("LINEAR_API_TOKEN", value)
    with linear_http() as requests:
        result = runner.invoke(main, args)
    assert result.exit_code != 0
    assert "LINEAR_API_TOKEN" in result.output
    assert requests == []
    assert config_path.read_bytes() == original
    assert not (registry.root / "harbor-web").exists()


@pytest.mark.parametrize("args", [(), ("--help",), ("init", "--help"), ("linear", "create", "--help")],
                         ids=["bare", "help", "init-help", "linear-create-help"])
def test_help_does_not_contact_linear(invoke, linear_http, args):
    with linear_http() as requests:
        assert "Usage:" in invoke(*args)
    assert requests == []


@pytest.mark.parametrize("args, name", [
    (("init", "harbor-web", "--github", "https://github.com/team/harbor-web", "--linear", " project-1 , team-1 "), "harbor-web"),
    (("linear", "link", "atlas-api", " project-1 , team-1 "), "atlas-api"),
], ids=["init", "link"])
def test_linear_pair_is_trimmed_without_contacting_linear(invoke, project, registry, linear_http, args, name):
    with linear_http() as requests:
        invoke(*args)
    assert requests == []
    linear = registry.load(name).config.linear
    assert (linear.project_id, linear.team_id) == ("project-1", "team-1")


@pytest.mark.parametrize("args", [
    ["init", "harbor-web", "--linear", " "],
    ["linear", "link", "atlas-api", " ,team-1"],
    ["linear", "link", "atlas-api", "project-1, "],
    ["linear", "create", "atlas-api", " ", "--team-id", "team-1"],
    ["linear", "create", "atlas-api", "Atlas", "--team-id", " "],
    ["linear", "create", "atlas-api", "Atlas"],
], ids=["init-blank-pair", "link-blank-project", "link-blank-team", "create-blank-name", "create-blank-team", "create-no-team"])
def test_blank_linear_options_are_rejected_before_cloning_or_http(runner, project, registry, linear_http, args):
    with linear_http() as requests:
        result = runner.invoke(main, args)
    assert result.exit_code != 0
    assert "Error:" in result.output
    assert not (registry.root / "harbor-web").exists()
    assert requests == []


def test_create_links_remote_project_using_explicit_team_id(invoke, config_path, linear_http, created_project, payload):
    with linear_http(created_project) as requests:
        output = invoke(*CREATE)
    assert "project-1" in output
    assert "team-1" in output
    assert "https://linear.app/team/project/atlas" in output
    assert yaml.safe_load(config_path.read_text())["linear"] == {"project_id": "project-1", "team_id": "team-1"}
    assert payload(requests[0])["variables"]["input"] == {"name": "Atlas", "teamIds": ["team-1"]}
    assert len(requests) == 1


def test_create_api_failure_preserves_local_link(runner, config_path, linear_http):
    original = config_path.read_text()
    with linear_http({"errors": [{"message": "Invalid team"}]}):
        result = runner.invoke(main, CREATE)
    assert result.exit_code != 0
    assert "Invalid team" in result.output
    assert config_path.read_text() == original


def test_create_requires_valid_local_project_before_http(runner, config_path, linear_http):
    config_path.write_text("invalid yaml config")
    with linear_http() as requests:
        result = runner.invoke(main, CREATE)
    assert result.exit_code != 0
    assert "project.yaml" in result.output
    assert requests == []


@EXACT_NAMES
def test_linear_create_recovery_names_exact_project(runner, invoke, registry, linear_http, created_project, name):
    project = registry.init(name)
    path = project.root / "project.yaml"
    original = path.read_text()
    with linear_http(created_project) as requests, patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
        result = runner.invoke(main, ["linear", "create", "--team-id", "team-1", "--", name, "Atlas"])
    assert result.exit_code != 0
    assert "created" in result.output.lower()
    assert "project-1" in result.output
    assert "https://linear.app/team/project/atlas" in result.output
    recovery = shlex.split(result.output.strip().splitlines()[-1])
    assert recovery == ["battuta-project", "linear", "link", "--", name, "project-1,team-1"]
    assert "disk full" in result.output
    assert path.read_text() == original
    assert len(requests) == 1
    with linear_http() as recovery_requests:
        invoke(*recovery[1:])
    assert recovery_requests == []
    assert registry.load(name).config.linear.project_id == "project-1"


def test_create_unreadable_local_config_reports_remote_success_and_recovery(runner, config_path, linear_http, created_project):
    def created(request):
        config_path.write_bytes(b"\xff")
        return created_project

    with linear_http(created) as requests:
        result = runner.invoke(main, CREATE)
    assert result.exit_code != 0
    assert "project.yaml" in result.output
    assert "project-1" in result.output
    assert "https://linear.app/team/project/atlas" in result.output
    assert "linear link -- atlas-api project-1,team-1" in result.output
    assert len(requests) == 1


def test_name_only_init_creates_discoverable_project_without_github(invoke, registry, linear_http):
    with linear_http() as requests:
        assert "Initialized project: linth" in invoke("init", "linth")
        assert "**linth**" in invoke("list")
        assert "Repository URL: no GitHub repository linked yet" in invoke("explain", "linth")
        assert requests == []
    project = registry.load("linth")
    assert project.code.is_dir()
    assert list(project.code.iterdir()) == []
    assert project.config.github.repository is None


def test_init_uses_explicit_name_with_different_repository_basename(invoke, registry):
    invoke("init", "linth", "--github", "https://github.com/team/other.git")
    project = registry.load("linth")
    assert project.name == "linth"
    assert project.config.github.repository == "team/other"
    assert project.code.name == "code"


@pytest.mark.parametrize("value", ["", " ", "project-1", "project-1,", ",team-1", " , ", "project-1,team-1,extra", "project-1,,team-1"],
                         ids=["empty", "space", "id-only", "trailing-comma", "leading-comma", "blank-pair", "extra-field", "double-comma"])
@pytest.mark.parametrize("command", ["init", "link"], ids=["init", "link"])
def test_malformed_linear_pairs_leave_configuration_unchanged(runner, registry, config_path, linear_http, command, value):
    args = ("init", "linth", "--linear", value) if command == "init" else ("linear", "link", "atlas-api", value)
    config = config_path.read_bytes()
    with linear_http() as requests:
        result = runner.invoke(main, args)
    assert result.exit_code != 0
    assert "<project-id>,<team-id>" in result.output
    assert requests == []
    assert config_path.read_bytes() == config
    assert not (registry.root / "linth").exists()


def test_github_link_preserves_workspace_and_linear_metadata(invoke, registry, clone, linear_http):
    invoke("init", "linth", "--linear", "project-1,team-1")
    project = registry.load("linth")
    marker = project.code / "notes.txt"
    marker.write_text("Keep my work")
    spec = project.root / "specs" / "api" / "v1" / "spec.md"
    spec.parent.mkdir(parents=True)
    spec.write_text("# Existing requirements\n")
    metadata = project.root / "specs" / ".config.json"
    metadata.write_text('{"specs": [{"name": "API", "versions": ["v1"]}]}')
    artifacts = {path: path.read_bytes() for path in (spec, metadata)}
    clone.reset_mock(side_effect=True)
    with linear_http() as requests:
        assert "https://github.com/team/other" in invoke("github", "link", "linth", "git@github.com:team/other.git")
        assert requests == []
    clone.assert_not_called()
    linked = registry.load("linth")
    assert linked.name == "linth"
    assert linked.config.github.repository == "team/other"
    assert linked.config.linear.project_id == "project-1"
    assert linked.config.linear.team_id == "team-1"
    assert marker.read_text() == "Keep my work"
    for path, original in artifacts.items():
        assert path.read_bytes() == original


@pytest.mark.parametrize("url", ["not-a-url", "https://gitlab.com/team/repo", "https://github.com/team/repo/tree/main"],
                         ids=["not-a-url", "other-host", "subpath"])
def test_github_link_invalid_url_preserves_configuration(runner, config_path, url):
    config = config_path.read_bytes()
    result = runner.invoke(main, ["github", "link", "atlas-api", url])
    assert result.exit_code != 0
    assert "GitHub" in result.output
    assert config_path.read_bytes() == config


def test_github_link_write_failure_preserves_configuration(runner, config_path):
    config = config_path.read_bytes()
    with patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
        result = runner.invoke(main, ["github", "link", "atlas-api", "https://github.com/team/other"])
    assert result.exit_code != 0
    assert "disk full" in result.output
    assert config_path.read_bytes() == config
