"""Installed validation uses one portable catalog and no discovery output."""

import pytest
import click
import shlex
import os
import subprocess
from click.testing import CliRunner

from battuta_packaging.cli import main
from battuta_packaging.services import install_services
from skill_fixtures import skill_catalog


def test_services_can_resolve_tools_without_shell_initialization(tmp_path, monkeypatch):
    tools = tmp_path / "tool-bin"
    tools.mkdir()
    cli = tools / "battuta-project"
    cli.write_text("#!/bin/sh\nprintf installed\n")
    cli.chmod(0o700)
    monkeypatch.setenv("UV_TOOL_BIN_DIR", str(tools))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    install_services(tmp_path / "release")
    for unit in (tmp_path / "config/systemd/user").glob("*.service"):
        value, = (line.removeprefix('Environment="PATH=').removesuffix('"')
                  for line in unit.read_text().splitlines() if line.startswith('Environment="PATH='))
        result = subprocess.run(["/bin/sh", "-c", "battuta-project"],
                                env={**os.environ, "PATH": value}, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        assert result.stdout == "installed"


@pytest.mark.parametrize("names", [["memory"], []])
def test_relocated_catalog_validates_without_discovery(tmp_path, names):
    root = tmp_path / "release"
    (root / "skills-hub").mkdir(parents=True)
    for role in ("cos", "manager"):
        skill_catalog(root, role, names)
    if names:
        (root / "skills-hub/memory/LICENSE").write_text("Required notice")
    moved = tmp_path / "moved"
    root.rename(moved)
    result = CliRunner().invoke(main, ["validate-skills", str(moved)])
    assert result.exit_code == 0, result.output
    for role in ("cos", "manager"):
        assert not (moved / f"bots/{role}-bot/.pi").exists()
    if names:
        assert (moved / "skills-hub/memory/references/tools.md").read_text() == "memory tools"
        assert (moved / "skills-hub/memory/LICENSE").read_text() == "Required notice"


def test_service_installation_preflights_all_owned_units(tmp_path, monkeypatch):
    root = tmp_path / "release"
    config = tmp_path / "config"
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config))
    install_services(root)
    units = config / "systemd/user"
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    install_services(root)
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
    assert len(before) == 5
    changed = units / "battuta-manager.service"
    changed.write_text("custom")
    with pytest.raises(click.ClickException):
        install_services(root)
    assert changed.read_text() == "custom"
    assert (units / "battuta-cos.service").read_bytes() == before["battuta-cos.service"]


def test_worker_service_launches_release_profile_with_private_state(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    install_services(tmp_path / "release")
    unit = (tmp_path / "config/systemd/user/battuta-worker.service").read_text()
    command = next(line.removeprefix("ExecStart=") for line in unit.splitlines() if line.startswith("ExecStart="))
    args = shlex.split(command)
    assert args[:4] == ["/usr/bin/script", "-q", "-e", "-c"]
    assert shlex.split(args[4]) == [str(tmp_path / "release/bin/battuta"), "worker", "--bot-dir", str(tmp_path / "release/bots/worker")]
    assert f"WorkingDirectory={tmp_path}/release/bots/worker" in unit
    assert "UMask=0077" in unit
    assert "Wants=network-online.target battuta-memory.service" in unit
    assert "Requires=" not in unit


def test_explicit_service_replacement_switches_release_without_starting_it(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    first = tmp_path / "battuta-v1"
    second = tmp_path / "battuta-v2"
    install_services(first)
    units = tmp_path / "config/systemd/user"
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    with pytest.raises(click.ClickException):
        install_services(second)
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
    result = CliRunner().invoke(main, ["install-services", "--root", str(second), "--replace"])
    assert result.exit_code == 0, result.output
    for path in units.iterdir():
        assert str(second) in path.read_text()
        assert str(first) not in path.read_text()
    assert not (units / "default.target.wants").exists()
    assert not second.exists()


def test_service_replacement_refuses_symlinks_before_any_write(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    install_services(tmp_path / "release")
    units = tmp_path / "config/systemd/user"
    target = tmp_path / "custom.service"
    target.write_text("private custom service")
    worker = units / "battuta-worker.service"
    worker.unlink()
    worker.symlink_to(target)
    before = {p.name: p.read_bytes() for p in units.iterdir()}
    result = CliRunner().invoke(main, ["install-services", "--root", str(tmp_path / "new"), "--replace"])
    assert result.exit_code != 0
    assert worker.is_symlink()
    assert {p.name: p.read_bytes() for p in units.iterdir()} == before
