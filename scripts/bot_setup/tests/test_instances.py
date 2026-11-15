"""Counts and instance identities must not select another bot's state."""

import pytest
import click
import os
from click.testing import CliRunner

from bot_setup import instances
from bot_setup.cli import main
from skill_fixtures import manifest_text


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


@pytest.mark.parametrize("bot", ["worker-0", "worker-01", "../cos-bot", "worker/1", "unknown"])
def test_invalid_instance(tmp_path, bot):
    with pytest.raises(click.ClickException):
        instances.instance_paths(tmp_path, tmp_path, bot)


def test_workers_cli(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("BATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_2_TYPE=general\n")
    result = CliRunner().invoke(main, ["workers", "--env-file", str(env_file)])
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
