"""Service generation selects workers without activating or exposing credentials."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock

import click
import pytest

from battuta_packaging import services


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    """The bot setup boundary reads a private env and selects three workers."""
    env_file = tmp_path / ".env.prod"
    env_file.write_text("")
    values = {f"BATTUTA_WORKER_{n}_TYPE": "general" for n in (1, 2, 3)} | {"COS_TELEGRAM_TOKEN": "private-sentinel"}
    monkeypatch.setattr(services, "read_env", MagicMock(return_value=values))
    monkeypatch.setattr(services, "deployment_workers", MagicMock(return_value=["worker-1", "worker-2", "worker-3"]))
    monkeypatch.setattr(services, "worker_environment", MagicMock(return_value={"BATTUTA_WORKER_CAPABILITIES": '["research"]'}))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    monkeypatch.setattr(services, "check_node", lambda *a: {})
    monkeypatch.setattr(services.subprocess, "check_output", lambda *a, **k: str(tmp_path / "tool-bin") + "\n")
    monkeypatch.setattr(services.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout=""))
    return tmp_path / "release", env_file, Path("/tools/node"), tmp_path / "config/systemd/user"


@pytest.mark.parametrize("count", [0, 1, 3], ids=lambda count: f"{count}-workers")
def test_selected_units_are_private_and_never_activated(deployment, count, capsys):
    root, env, node, units = deployment
    services.deployment_workers.return_value = [f"worker-{n}" for n in range(1, count + 1)]
    services.install_services(root, env_file=env, node=node)
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    services.install_services(root, env_file=env, node=node)
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
    assert services.worker_environment.call_count == 2 * count
    text = b"".join(before.values()).decode()
    assert "private-sentinel" not in text
    worker = before["battuta-worker@.service"].decode()
    assert "worker-%i" in worker
    assert "--mode service" in worker
    assert "--env-file" in worker
    doc = before["battuta-doc.service"].decode()
    assert "run-component --component doc" in doc and "UMask=0077" in doc
    assert f"ReadWritePaths={Path.home()}/.battuta/doc-service" in doc and "ProtectHome=read-only" in doc
    assert not (units / "default.target.wants").exists()
    assert ("battuta-worker@3.service" in capsys.readouterr().out) == (count == 3)


@pytest.mark.parametrize("symlink", [False, True], ids=["custom-file", "symlink"])
def test_conflicting_units_preflight_before_writes(deployment, symlink):
    root, env, node, units = deployment
    units.mkdir(parents=True)
    custom = units / "battuta-manager.service"
    if symlink:
        custom.symlink_to(env)
    else:
        custom.write_text("custom")
    with pytest.raises(click.ClickException):
        services.install_services(root, env_file=env, node=node)
    assert len(list(units.iterdir())) == 1
    if symlink:
        with pytest.raises(click.ClickException):
            services.install_services(root, env_file=env, node=node, replace=True)


def test_excess_running_worker_is_not_stopped(deployment, monkeypatch):
    root, env, node, units = deployment
    monkeypatch.setattr(services.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout="battuta-worker@4.service loaded active running worker\n"))
    with pytest.raises(click.ClickException, match="worker"):
        services.install_services(root, env_file=env, node=node)
    assert not units.exists()


def test_influencer_installs_only_worker_and_support_services(deployment, capsys):
    root, env, node, units = deployment
    services.deployment_workers.return_value = ["worker-1"]
    services.install_services(root, env_file=env, node=node, deployment="influencer")
    services.deployment_workers.assert_called_with(ANY, ANY, "influencer")
    assert {p.name for p in units.iterdir()} == {"battuta-worker@.service", "battuta-artifacts.service"}
    assert "battuta-memory.service" not in (units / "battuta-worker@.service").read_text()
    output = capsys.readouterr().out
    assert "battuta-worker@1.service" in output
    assert "battuta-cos.service" not in output and "battuta-manager.service" not in output
