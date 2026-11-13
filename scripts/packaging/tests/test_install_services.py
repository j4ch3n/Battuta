"""Service generation selects workers without activating or exposing credentials."""

from pathlib import Path
from types import SimpleNamespace

import click
import pytest

from battuta_packaging import services


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    env_file = tmp_path / ".env.prod"
    env_file.write_text("WORKER_BOT_COUNT=3\nCOS_TELEGRAM_TOKEN=private-sentinel\n")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    monkeypatch.setattr(services, "check_node", lambda *a: {})
    monkeypatch.setattr(services.subprocess, "check_output", lambda *a, **k: str(tmp_path / "tool-bin") + "\n")
    monkeypatch.setattr(services.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout=""))
    return tmp_path / "release", env_file, Path("/tools/node"), tmp_path / "config/systemd/user"


@pytest.mark.parametrize("count", [0, 1, 3])
def test_count_driven_units_are_private_and_never_activated(deployment, count, capsys):
    root, env, node, units = deployment
    env.write_text(f"WORKER_BOT_COUNT={count}\nCOS_TELEGRAM_TOKEN=private-sentinel\n")
    services.install_services(root, env_file=env, node=node)
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    services.install_services(root, env_file=env, node=node)
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
    assert set(before) == {"battuta-cos.service", "battuta-manager.service", "battuta-memory.service", "battuta-artifacts.service", "battuta-speech.service", "battuta-worker@.service"}
    text = b"".join(before.values()).decode()
    assert "private-sentinel" not in text
    assert "/tools" in text
    worker = before["battuta-worker@.service"].decode()
    assert "worker-%i" in worker
    assert "--mode service" in worker
    assert "/usr/bin/script -q -e -c" in worker
    assert "--env-file" in worker
    assert "verify-speech" in before["battuta-speech.service"].decode()
    assert not (units / "default.target.wants").exists()
    assert ("battuta-worker@3.service" in capsys.readouterr().out) == (count == 3)


@pytest.mark.parametrize("symlink", [False, True])
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
