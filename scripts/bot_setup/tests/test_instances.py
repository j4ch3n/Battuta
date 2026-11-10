"""Counts and instance identities must not select another bot's state."""

import pytest
import click
from click.testing import CliRunner

from bot_setup import instances
from bot_setup.cli import main


@pytest.mark.parametrize("count,expected", [("0", []), ("1", ["worker-1"]), ("3", ["worker-1", "worker-2", "worker-3"])])
def test_worker_names(tmp_path, count, expected):
    assert instances.worker_names({"WORKER_BOT_COUNT": count}, tmp_path / ".env") == expected


@pytest.mark.parametrize("value", [None, "", "-1", "1.5", "true", "١", "secret-sentinel"])
def test_invalid_counts_do_not_expose_values(tmp_path, value):
    with pytest.raises(click.ClickException) as error:
        instances.worker_names({} if value is None else {"WORKER_BOT_COUNT": value}, tmp_path / ".env")
    assert "WORKER_BOT_COUNT" in str(error.value)
    assert "secret-sentinel" not in str(error.value)


@pytest.mark.parametrize("bot,role,profile", [("cos-bot", "cos", "cos-bot"), ("manager-bot", "manager", "manager-bot"), ("worker-2", "worker", "worker")])
def test_instance_paths(tmp_path, bot, role, profile):
    root, home = tmp_path / "release", tmp_path / "home"
    assert instances.instance_paths(root, home, bot) == (role, root / "bots" / profile, home / ".battuta/pi-bots" / bot)


@pytest.mark.parametrize("bot", ["worker-0", "worker-01", "../cos-bot", "worker/1", "unknown"])
def test_invalid_instance(tmp_path, bot):
    with pytest.raises(click.ClickException):
        instances.instance_paths(tmp_path, tmp_path, bot)


def test_workers_cli(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("WORKER_BOT_COUNT=2\n")
    result = CliRunner().invoke(main, ["workers", "--env-file", str(env_file)])
    assert result.exit_code == 0, result.output
    assert result.output.splitlines() == ["worker-1", "worker-2"]
