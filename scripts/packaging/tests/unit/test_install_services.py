"""Service generation selects workers without activating or exposing credentials."""

from pathlib import Path
from types import SimpleNamespace

import click
import pytest

from battuta_packaging import services
from skill_fixtures import manifest_text


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    profile = tmp_path / "release/bots/worker"
    profile.mkdir(parents=True)
    (profile / "bot.toml").write_text(manifest_text("worker", []))
    (profile / "abilities.json").write_text('{"research": {}}')
    env_file = tmp_path / ".env.prod"
    env_file.write_text("BATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_2_TYPE=general\nBATTUTA_WORKER_3_TYPE=general\nCOS_TELEGRAM_TOKEN=private-sentinel\n")
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


@pytest.mark.parametrize("count", [0, 1, 3], ids=lambda count: f"{count}-workers")
def test_selected_units_are_private_and_never_activated(deployment, count, capsys):
    root, env, node, units = deployment
    env.write_text("".join(f"BATTUTA_WORKER_{n}_TYPE=general\n" for n in range(1, count + 1)) + "COS_TELEGRAM_TOKEN=private-sentinel\n")
    services.install_services(root, env_file=env, node=node)
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    services.install_services(root, env_file=env, node=node)
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
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
    profile = root / "bots/worker-influencer"
    profile.mkdir()
    source = Path(__file__).parents[4] / "bots/worker-influencer/bot.toml"
    (profile / "bot.toml").write_text(source.read_text())
    (profile / "abilities.json").write_text('{"mobile-control": {}}')
    env.write_text("BATTUTA_WORKER_1_TYPE=influencer\n")
    services.install_services(root, env_file=env, node=node, deployment="influencer")
    assert {p.name for p in units.iterdir()} == {"battuta-worker@.service", "battuta-artifacts.service"}
    assert "battuta-memory.service" not in (units / "battuta-worker@.service").read_text()
    output = capsys.readouterr().out
    assert "battuta-worker@1.service" in output
    assert "battuta-cos.service" not in output and "battuta-manager.service" not in output


@pytest.mark.parametrize("selection", ["", "BATTUTA_WORKER_1_TYPE=general\n", "BATTUTA_WORKER_1_TYPE=influencer\nBATTUTA_WORKER_2_TYPE=influencer\n"],
                         ids=["none", "general-type", "two-workers"])
def test_influencer_rejects_invalid_service_selection(deployment, selection):
    root, env, node, units = deployment
    env.write_text(selection)
    with pytest.raises(click.ClickException):
        services.install_services(root, env_file=env, node=node, deployment="influencer")
    assert not units.exists()
