"""Battuta owns private paths and executable handoff, not browser behavior."""

import json

import click
import pytest

from bot_setup.browser import configure_browser, validate_browser


@pytest.fixture
def browser_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    profile = tmp_path / "profile"
    (profile / ".pi").mkdir(parents=True)
    (profile / ".pi/settings.json").write_text("{}")
    return home, profile


@pytest.mark.parametrize("bot", ["cos-bot", "worker-1", "worker-2"])
def test_private_browser_settings_preserve_preferences_and_use_bot_identity(browser_home, bot):
    home, profile = browser_home
    private = home / ".battuta/pi-bots" / bot
    path = private / ".pi/settings.json"
    path.parent.mkdir(parents=True)
    path.write_text('{"defaultModel":"personal","pi-browser-use":{"viewport":"1440x900"}}')
    for _ in range(2):
        configure_browser(profile, private, home=home, bot=bot)
    settings = json.loads(path.read_text())
    assert settings["defaultModel"] == "personal"
    assert settings["pi-browser-use"]["userDataDir"] == str(private / ".pi/browser-research")
    assert settings["pi-browser-use"]["executablePath"] == "${CHROME_PATH}"
    assert settings["pi-browser-use"]["viewport"] == "1440x900"
    for directory in (private / ".pi/browser-research", home / ".battuta/browser-screenshot"):
        assert directory.is_dir()
        assert directory.stat().st_mode & 0o077 == 0
    assert not (home / ".pi").exists()


def test_conflicting_profile_is_rejected_without_changing_private_settings(browser_home):
    home, profile = browser_home
    private = home / ".battuta/pi-bots/worker-1"
    path = private / ".pi/settings.json"
    path.parent.mkdir(parents=True)
    original = '{"defaultModel":"personal","pi-browser-use":{"userDataDir":"/shared/private-sentinel"}}'
    path.write_text(original)
    with pytest.raises(click.ClickException) as error:
        configure_browser(profile, private, home=home, bot="worker-1")
    assert "private-sentinel" not in str(error.value)
    assert path.read_text() == original
    assert not (private / ".pi/browser-research").exists()


@pytest.mark.parametrize("available", [True, False])
def test_launch_discovers_chromium_in_actual_path(browser_home, monkeypatch, tmp_path, available):
    home, profile = browser_home
    private = home / ".battuta/pi-bots/worker-1"
    configure_browser(profile, private, home=home, bot="worker-1")
    executable = tmp_path / "unusual bin/chromium-browser"
    executable.parent.mkdir()
    executable.write_text("#!/bin/sh\nexit 99\n")
    executable.chmod(0o700 if available else 0o600)
    monkeypatch.setenv("PATH", str(executable.parent))
    monkeypatch.setattr("bot_setup.browser.sys.platform", "linux")
    if available:
        assert validate_browser(profile, private, home=home, bot="worker-1") == {"CHROME_PATH": str(executable)}
    else:
        with pytest.raises(click.ClickException, match="chromium-browser"):
            validate_browser(profile, private, home=home, bot="worker-1")
