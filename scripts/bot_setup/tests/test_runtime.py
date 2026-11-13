"""First-run defaults never replace operator settings or escape private homes."""

from concurrent.futures import ThreadPoolExecutor
import json

import click
import pytest

from bot_setup.manifest import parse_manifest, Defaults
from bot_setup.runtime import resolve_agent_dir, initialize_settings_if_missing


def manifest(directory, role="cos"):
    return parse_manifest(f'''
[bot]
role = "{role}"
env_prefix = "TEST"
[runtime]
pi_coding_agent_dir = "{directory}"
[skills]
include = []
''', "fixture.toml")


@pytest.mark.parametrize("role,instance,directory,want", [
    ("cos", "cos-bot", "custom-cos/.pi", "custom-cos/.pi"),
    ("manager", "manager-bot", "manager-bot/.pi", "manager-bot/.pi"),
    ("worker", "worker-2", "workers/{instance}/.pi", "workers/worker-2/.pi"),
])
def test_paths_use_manifest_under_fixed_base(tmp_path, role, instance, directory, want):
    assert resolve_agent_dir(manifest(directory, role), instance, tmp_path) == tmp_path / ".battuta/pi-bots" / want


@pytest.mark.parametrize("directory", ["/outside/.pi", "../outside/.pi", "{unknown}/.pi", "cos-bot/../other/.pi"])
def test_invalid_paths_are_rejected(tmp_path, directory):
    with pytest.raises(click.ClickException):
        resolve_agent_dir(manifest(directory), "cos-bot", tmp_path)
    assert not (tmp_path / ".battuta").exists()


def test_worker_instances_cannot_share_one_directory(tmp_path):
    with pytest.raises(click.ClickException):
        resolve_agent_dir(manifest("shared/.pi", "worker"), "worker-1", tmp_path)


def test_symlinked_ancestor_is_rejected(tmp_path):
    (tmp_path / ".battuta").symlink_to(tmp_path / "elsewhere")
    with pytest.raises(click.ClickException):
        resolve_agent_dir(manifest("cos-bot/.pi"), "cos-bot", tmp_path)


def test_missing_settings_created_privately_and_concurrently(tmp_path):
    directory = tmp_path / "bot/.pi"
    defaults = Defaults(provider="example", model="test-model", thinking="high")
    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda _: initialize_settings_if_missing(directory, defaults), range(16)))
    path = directory / "settings.json"
    assert json.loads(path.read_text()) == {
        "defaultProvider": "example", "defaultModel": "test-model", "defaultThinkingLevel": "high",
    }
    assert path.stat().st_mode & 0o777 == 0o600
    assert list(directory.iterdir()) == [path]


@pytest.mark.parametrize("original", ["{}", '{ "defaultModel": "personal", "theme": "light" }\n'])
def test_existing_settings_are_not_backfilled_or_reformatted(tmp_path, original):
    path = tmp_path / "settings.json"
    path.write_text(original)
    initialize_settings_if_missing(tmp_path, Defaults(provider="example", model="other", thinking="low"))
    assert path.read_text() == original


@pytest.mark.parametrize("kind", ["malformed", "symlink", "directory"])
def test_unsafe_existing_settings_fail_without_replacement(tmp_path, kind):
    path = tmp_path / "settings.json"
    if kind == "malformed":
        path.write_text("private-sentinel")
    elif kind == "symlink":
        path.symlink_to(tmp_path / "outside")
    else:
        path.mkdir()
    with pytest.raises(click.ClickException) as error:
        initialize_settings_if_missing(tmp_path, Defaults(provider="example", model="other", thinking="low"))
    assert "private-sentinel" not in str(error.value)
    if kind == "malformed":
        assert path.read_text() == "private-sentinel"
    elif kind == "symlink":
        assert path.is_symlink()
        assert not (tmp_path / "outside").exists()
    else:
        assert path.is_dir()
