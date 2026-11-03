"""Installed validation uses one portable catalog and no discovery output."""

import pytest
import click
from click.testing import CliRunner

from battuta_packaging.cli import main
from battuta_packaging.services import install_services
from skill_fixtures import skill_catalog


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
    assert len(before) == 4
    changed = units / "battuta-manager.service"
    changed.write_text("custom")
    with pytest.raises(click.ClickException):
        install_services(root)
    assert changed.read_text() == "custom"
    assert (units / "battuta-cos.service").read_bytes() == before["battuta-cos.service"]
