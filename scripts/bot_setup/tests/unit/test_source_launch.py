"""Worker selection must apply before source launch or private provisioning."""

import os
from pathlib import Path

import click
import pytest

from bot_setup.source_launch import run_source_worker
from bot_setup import source_launch
from bot_setup import configure
from skill_fixtures import manifest_text, unselected_worker_checkout


def test_source_setup_prepares_selected_influencer_profile(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("BATTUTA_WORKER_1_TYPE=influencer\n")
    prepared = []
    monkeypatch.setattr(configure, "configure_worker", lambda root, **kwargs: prepared.append(kwargs.get("profile")))
    configure.configure_source(tmp_path, role="worker", env_file=env_file)
    assert prepared == [None, tmp_path / "bots/worker-influencer"]


def test_influencer_source_launch_uses_selected_profile(tmp_path, monkeypatch):
    root = tmp_path / "source"
    for name in ("worker", "worker-influencer"):
        profile = root / "bots" / name
        profile.mkdir(parents=True)
        (profile / "bot.toml").write_text(manifest_text("worker", []))
    cli = root / "assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
    cli.parent.mkdir(parents=True)
    cli.touch()
    env_file = root / ".env"
    env_file.write_text("SUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=fixture\nBATTUTA_WORKER_1_TYPE=influencer\n")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    private = tmp_path / "home/.battuta/pi-bots/worker-1"
    selected = []
    monkeypatch.setattr(source_launch, "worker_environment", lambda *args: {})
    monkeypatch.setattr(source_launch, "validate_mobile_device", lambda *args: None)
    monkeypatch.setattr(source_launch, "acquire_instance_lock", lambda *args: None)
    monkeypatch.setattr(source_launch, "prepare_launch_worker", lambda root, profile, *args, **kwargs: selected.append(profile))
    monkeypatch.setattr(source_launch, "assignment_environment", lambda *args: {})
    monkeypatch.setattr(source_launch, "validate_browser", lambda *args, **kwargs: {})
    monkeypatch.setattr(os, "chdir", lambda path: selected.append(path))
    monkeypatch.setattr(os, "execve", lambda *args: None)
    run_source_worker(root, bot_dir=private, env_file=env_file, node=Path("/node"))
    assert selected == [root / "bots/worker-influencer"] * 2


UNSELECTED = [
    pytest.param("", "worker-1", id="no-selection"),
    pytest.param("BATTUTA_WORKER_0_TYPE=general", "worker-1", id="index-zero"),
    pytest.param("BATTUTA_WORKER_1_TYPE=", "worker-1", id="empty-type"),
    pytest.param("BATTUTA_WORKER_1_TYPE=general", "worker-2", id="other-worker-selected"),
]


@pytest.mark.parametrize("selection,worker", UNSELECTED)
def test_unselected_worker_stops_before_provisioning(tmp_path, monkeypatch, selection, worker):
    root, env_file = unselected_worker_checkout(tmp_path, selection)
    bot = tmp_path / "private" / worker
    monkeypatch.setattr(os, "execve", lambda *args: pytest.fail("Unselected worker executed"))
    with pytest.raises(click.ClickException, match="BATTUTA_WORKER"):
        run_source_worker(root, bot_dir=bot, env_file=env_file, node=Path("/node"))
    assert not bot.exists()
