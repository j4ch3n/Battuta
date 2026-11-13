"""Manager setup removes the previously managed subagent package."""

import pytest
import click

from bot_setup.subagents import remove_manager_subagents


def test_removal_preserves_other_resources_and_settings():
    settings = {
        "packages": ["npm:pi-subagents@0.82.1", {"source": "npm:pi-subagents@0.82.1"}, "npm:custom@1"],
        "subagents": {"custom": True},
    }
    remove_manager_subagents(settings)
    remove_manager_subagents(settings)
    assert settings == {"packages": ["npm:custom@1"], "subagents": {"custom": True}}


def test_invalid_packages_fail():
    with pytest.raises(click.ClickException):
        remove_manager_subagents({"packages": "invalid"})
