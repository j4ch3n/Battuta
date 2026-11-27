"""Counts and instance identities must not select another bot's state."""

import pytest
import click
import os
from pathlib import Path
import shutil
import subprocess
from click.testing import CliRunner

from bot_setup import instances
from bot_setup.cli import main
from bot_setup.manifest import load_profile
from skill_fixtures import manifest_text


def test_actual_worker_profiles_route_by_capability():
    root = Path(__file__).resolve().parents[4]
    general = load_profile(root / "bots/worker/bot.toml", "worker")
    influencer = load_profile(root / "bots/worker-influencer/bot.toml", "worker")
    assert general.worker.types["general"].capabilities == ["research"]
    assert influencer.worker.types["influencer"].capabilities == ["mobile-control"]
    assert not any("pi-subagents" in package for package in [*general.packages.pi, *influencer.packages.pi])
    assert any("pi-droid" in package for package in influencer.packages.pi)
    assert not any("pi-browser-use" in package for package in influencer.packages.pi)
    assert "browser-evidence" not in influencer.skills.include


@pytest.mark.parametrize("values,expected", [
    ({}, []),
    ({"BATTUTA_WORKER_1_TYPE": "general"}, ["worker-1"]),
    ({"BATTUTA_WORKER_10_TYPE": "general", "BATTUTA_WORKER_2_TYPE": "general"}, ["worker-2", "worker-10"]),
])
def test_worker_names(tmp_path, values, expected):
    assert instances.worker_names(values, tmp_path / ".env") == expected


@pytest.mark.parametrize("key,value", [
    ("BATTUTA_WORKER_0_TYPE", "general"), ("BATTUTA_WORKER_01_TYPE", "general"),
    ("BATTUTA_WORKER_١_TYPE", "general"), ("BATTUTA_WORKER_X_TYPE", "secret-sentinel"),
    ("BATTUTA_WORKER_1_TYPE", ""), ("BATTUTA_WORKER_1_TYPE", " "),
])
def test_invalid_selections_do_not_expose_values(tmp_path, key, value):
    with pytest.raises(click.ClickException) as error:
        instances.worker_names({key: value}, tmp_path / ".env")
    assert "BATTUTA_WORKER" in str(error.value)
    assert "secret-sentinel" not in str(error.value)


@pytest.mark.parametrize("bot,role,profile", [("cos-bot", "cos", "cos-bot"), ("manager-bot", "manager", "manager-bot"), ("worker-2", "worker", "worker")])
def test_instance_paths(tmp_path, bot, role, profile):
    root, home = tmp_path / "release", tmp_path / "home"
    directory = root / "bots" / profile
    directory.mkdir(parents=True)
    (directory / "bot.toml").write_text(manifest_text(role, []))
    assert instances.instance_paths(root, home, bot) == (role, root / "bots" / profile, home / ".battuta/pi-bots" / bot)

def test_influencer_uses_separate_profile_and_private_instance(tmp_path):
    for name in ("worker", "worker-influencer"):
        profile = tmp_path / "bots" / name
        profile.mkdir(parents=True)
        (profile / "bot.toml").write_text(manifest_text("worker", []))
    values = {"BATTUTA_WORKER_2_TYPE": "influencer"}
    assert instances.instance_paths(tmp_path, tmp_path / "home", "worker-2", values) == (
        "worker", tmp_path / "bots/worker-influencer", tmp_path / "home/.battuta/pi-bots/worker-2"
    )

def test_worker_capabilities_follow_selected_profile(tmp_path):
    for name, capability in (("worker", "research"), ("worker-influencer", "mobile-control")):
        profile = tmp_path / "bots" / name
        profile.mkdir(parents=True)
        (profile / "bot.toml").write_text(
            f'[worker]\ncapabilities=["{capability}"]\n[worker.types.influencer]\ncapabilities=[]\n[skills]\ninclude=[]'
        )
        (profile / "abilities.json").write_text('{"research": {}, "mobile-control": {}}')
    values = {"BATTUTA_WORKER_2_TYPE": "influencer"}
    assert instances.worker_environment(tmp_path, values, tmp_path / ".env", "worker-2") == {
        "BATTUTA_WORKER_CAPABILITIES": '["mobile-control"]'
    }


@pytest.mark.parametrize("state,returncode", [("device\n", 0), ("offline\n", 0), ("", 1)])
def test_mobile_device_preflight_requires_ready_device(monkeypatch, state, returncode):
    from types import SimpleNamespace

    monkeypatch.setattr(shutil, "which", lambda *args, **kwargs: "/bin/adb")
    seen = []
    def run(args, **kwargs):
        seen.append((args, kwargs["env"]))
        return SimpleNamespace(stdout=state, returncode=returncode)
    monkeypatch.setattr(subprocess, "run", run)
    env = {"ANDROID_SERIAL": "selected"}
    if state == "device\n" and returncode == 0:
        instances.validate_mobile_device(env)
    else:
        with pytest.raises(click.ClickException):
            instances.validate_mobile_device(env)
    assert seen == [(["/bin/adb", "get-state"], env)]


@pytest.mark.parametrize("bot", ["worker-0", "worker-01", "../cos-bot", "worker/1", "unknown"])
def test_invalid_instance(tmp_path, bot):
    with pytest.raises(click.ClickException):
        instances.instance_paths(tmp_path, tmp_path, bot)


@pytest.mark.parametrize("kind", ["general", "misspelled"])
def test_workers_cli(tmp_path, kind):
    profile = tmp_path / "bots/worker"
    profile.mkdir(parents=True)
    (profile / "bot.toml").write_text('[worker]\ncapabilities=[]\n[worker.types.general]\ncapabilities=[]\n[skills]\ninclude=[]')
    (profile / "abilities.json").write_text("{}")
    env_file = tmp_path / ".env"
    env_file.write_text(f"BATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_2_TYPE={kind}\n")
    result = CliRunner().invoke(main, ["workers", "--root", str(tmp_path), "--env-file", str(env_file)])
    if kind != "general":
        assert result.exit_code != 0
        assert "worker-1\n" not in result.output
        return
    assert result.exit_code == 0, result.output
    assert result.output.splitlines() == ["worker-1", "worker-2"]


def test_instance_lock_excludes_duplicates_and_releases_on_close(tmp_path):
    first = instances.acquire_instance_lock(tmp_path / "worker-1")
    try:
        with pytest.raises(click.ClickException):
            instances.acquire_instance_lock(tmp_path / "worker-1")
        other = instances.acquire_instance_lock(tmp_path / "worker-2")
        os.close(other)
        assert os.get_inheritable(first)
    finally:
        os.close(first)
    os.close(instances.acquire_instance_lock(tmp_path / "worker-1"))


def test_instance_lock_refuses_symlink(tmp_path):
    pi = tmp_path / "worker-1/.pi"
    pi.mkdir(parents=True)
    (pi / "instance.lock").symlink_to(tmp_path / "other")
    with pytest.raises(click.ClickException):
        instances.acquire_instance_lock(pi.parent)
