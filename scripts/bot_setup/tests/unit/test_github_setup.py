"""Manager GitHub CLI login check and its role restriction."""

import os
import re
from pathlib import Path
from unittest.mock import patch

import click
import pytest
from bot_setup.configure import configure_source
from bot_setup.github import check_github
from bot_setup.manifest import load_profile
from skill_fixtures import skill_catalog

ROOT = Path(__file__).resolve().parents[4]


def stub_gh(tmp_path: Path, monkeypatch, *, exit_code: int) -> Path:
    log = tmp_path / "gh.log"
    gh = tmp_path / "bin/gh"
    gh.parent.mkdir()
    gh.write_text(f'#!/bin/sh\necho "$@" >> "{log}"\necho "account octo-secret" \nexit {exit_code}\n')
    gh.chmod(0o755)
    monkeypatch.setenv("PATH", f"{gh.parent}:{os.environ['PATH']}")
    return log


def test_github_step_fails_when_gh_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(click.ClickException, match="gh"):
        check_github()


def test_github_step_fails_when_not_logged_in(tmp_path, monkeypatch):
    stub_gh(tmp_path, monkeypatch, exit_code=1)
    with pytest.raises(click.ClickException, match="gh auth login") as error:
        check_github()
    assert "octo-secret" not in str(error.value)


def test_github_step_passes_when_logged_in(tmp_path, monkeypatch, capsys):
    log = stub_gh(tmp_path, monkeypatch, exit_code=0)
    check_github()
    assert log.read_text().splitlines() == ["auth status --hostname github.com"]
    assert "octo-secret" not in capsys.readouterr().out


@pytest.mark.parametrize("profile,role", [("cos-bot", "cos"), ("worker", "worker")])
def test_github_step_is_manager_only(tmp_path, profile, role):
    text = (ROOT / "bots" / profile / "bot.toml").read_text()
    manifest = tmp_path / "bot.toml"
    manifest.write_text(re.sub(r"steps = \[", 'steps = ["github", ', text, count=1))
    with pytest.raises(click.ClickException, match="Invalid setup steps"):
        load_profile(manifest, role)


def test_signed_out_gh_stops_manager_source_setup_before_writes(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    stub_gh(tmp_path, monkeypatch, exit_code=1)
    skill_catalog(tmp_path, "manager")
    bot = tmp_path / "bots/manager-bot"
    (bot / "package.json").write_text("{}")
    (tmp_path / ".env").write_text("LINEAR_API_TOKEN=private-linear\nSUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=private-supabase\n")
    with patch("bot_setup.configure.run") as run, pytest.raises(click.ClickException, match="gh auth login"):
        configure_source(tmp_path, role="manager")
    run.assert_not_called()
    assert not (bot / ".pi").exists()
