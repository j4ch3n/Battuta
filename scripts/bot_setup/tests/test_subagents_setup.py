"""Native subagent defaults preserve explicit overrides and private state."""

import copy

import click
import pytest

from bot_setup.subagents import configure_subagents


def test_defaults_do_not_override_explicit_child_context(tmp_path):
    settings = {"theme": "custom", "packages": ["npm:custom@1"], "extensions": ["./custom.ts"], "subagents": {"defaultExtensions": [], "agentOverrides": {"worker": {"tools": ["read"]}}}}
    for _ in range(2):
        configure_subagents(settings, tmp_path)
    assert settings["theme"] == "custom"
    assert settings["extensions"] == ["./custom.ts"]
    assert settings["subagents"]["defaultExtensions"] == []
    assert settings["subagents"]["agentOverrides"]["worker"]["tools"] == ["read"]
    scout = settings["subagents"]["agentOverrides"]["scout"]
    assert scout["inheritSkills"] is False
    assert scout["inheritProjectContext"] is False
    assert "web_search" in scout["tools"]
    assert sum("pi-subagents" in str(entry) for entry in settings["packages"]) == 1


def test_native_default_extension_is_bound_to_explicit_workspace(tmp_path):
    settings = {}
    configure_subagents(settings, tmp_path)
    assert settings["subagents"]["defaultExtensions"] == [str(tmp_path / ".pi/npm/node_modules/pi-web-access/dist")]
    assert not (tmp_path / ".pi").exists()


@pytest.mark.parametrize("settings", [{"subagents": []}, {"packages": {}}, {"extensions": None}, {"subagents": {"agentOverrides": []}}, {"subagents": {"agentOverrides": {"worker": None}}}])
def test_invalid_configuration_is_rejected_without_mutation(tmp_path, settings):
    before = copy.deepcopy(settings)
    with pytest.raises(click.ClickException):
        configure_subagents(settings, tmp_path)
    assert settings == before
