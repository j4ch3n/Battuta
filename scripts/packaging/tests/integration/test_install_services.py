"""Service installation rejects worker selections the real bot setup refuses, before any side effect."""

from pathlib import Path
from types import SimpleNamespace

import click
import pytest

from battuta_packaging import services
from skill_fixtures import manifest_text

pytestmark = pytest.mark.integration


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    profile = tmp_path / "release/bots/worker"
    profile.mkdir(parents=True)
    (profile / "bot.toml").write_text(manifest_text("worker", []))
    (profile / "abilities.json").write_text('{"research": {}}')
    env_file = tmp_path / ".env.prod"
    env_file.write_text("BATTUTA_WORKER_1_TYPE=general\n")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    monkeypatch.setattr(services, "check_node", lambda *a: {})
    monkeypatch.setattr(services.subprocess, "check_output", lambda *a, **k: str(tmp_path / "tool-bin") + "\n")
    monkeypatch.setattr(services.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout=""))
    return tmp_path / "release", env_file, Path("/tools/node"), tmp_path / "config/systemd/user"


def test_unknown_type_fails_before_service_side_effects(deployment, monkeypatch):
    root, env, node, units = deployment
    env.write_text("BATTUTA_WORKER_1_TYPE=misspelled\n")
    calls = []
    monkeypatch.setattr(services.subprocess, "run", lambda *a, **k: calls.append(a))
    with pytest.raises(click.ClickException, match="worker type"):
        services.install_services(root, env_file=env, node=node)
    assert not calls
    assert not units.exists()


@pytest.mark.parametrize("selection", ["", "BATTUTA_WORKER_1_TYPE=general\n", "BATTUTA_WORKER_1_TYPE=influencer\nBATTUTA_WORKER_2_TYPE=influencer\n"],
                         ids=["none", "general-type", "two-workers"])
def test_influencer_rejects_invalid_service_selection(deployment, selection):
    root, env, node, units = deployment
    env.write_text(selection)
    with pytest.raises(click.ClickException):
        services.install_services(root, env_file=env, node=node, deployment="influencer")
    assert not units.exists()
