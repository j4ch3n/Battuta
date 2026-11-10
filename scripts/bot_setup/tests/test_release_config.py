"""Release configuration regenerates owned files, never private preferences."""

import json

import click
import pytest

from bot_setup import release


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    root, home = tmp_path / "install", tmp_path / "home"
    env_file = tmp_path / ".env.prod"
    env_file.write_text("WORKER_BOT_COUNT=2\nSUPABASE_URL=https://backend.example\nSUPABASE_SECRET_KEY=private-key\nLINEAR_API_TOKEN=private-linear\nCOS_TELEGRAM_TOKEN=101:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n")
    for role in ("cos-bot", "manager-bot", "worker"):
        bot = root / "bots" / role
        (bot / ".pi/skills").mkdir(parents=True)
        (bot / "AGENTS.md").write_text(role)
        (bot / ".pi/settings.json").write_text("{}")
        (bot / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture"}}')
    helper = root / "bots/_shared/memory-client/dist/configure-scheduler.js"
    helper.parent.mkdir(parents=True)
    helper.touch()
    monkeypatch.setattr(release, "run", lambda *args, **kwargs: None)
    return root, home, env_file


def test_release_preserves_private_state_and_regenerates_owned_files(deployment):
    root, home, env_file = deployment
    pi = home / ".battuta/pi-bots/cos-bot/.pi"
    pi.mkdir(parents=True)
    private = {"settings.json": '{"defaultModel":"personal","theme":"light"}', "auth.json": "opaque-auth", "models.json": "opaque-models", "sessions/session.jsonl": "opaque-session", "mcp-auth.json": "opaque-oauth"}
    for name, data in private.items():
        path = pi / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(data)
    (pi / "mcp.json").write_text('{"mcpServers":{"obsolete":{}}}')
    release.configure_release(root, env_file=env_file, home=home)
    release.configure_release(root, env_file=env_file, home=home)
    settings = json.loads((pi / "settings.json").read_text())
    assert settings["defaultModel"] == "personal"
    assert settings["theme"] == "light"
    assert {name: (pi / name).read_text() for name in private if name != "settings.json"} == {name: data for name, data in private.items() if name != "settings.json"}
    assert "obsolete" not in json.loads((pi / "mcp.json").read_text())["mcpServers"]
    for bot in ("cos-bot", "manager-bot", "worker-1", "worker-2"):
        private_pi = home / ".battuta/pi-bots" / bot / ".pi"
        servers = json.loads((private_pi / "mcp.json").read_text())["mcpServers"]
        assert servers["assignments"]["headers"] == {"apikey": "${SUPABASE_SECRET_KEY}"}
        assert (private_pi / "telegram.json").exists() == (bot == "cos-bot")
        assert (private_pi / "mcp.json").stat().st_mode & 0o777 == 0o600
        assert not (private_pi.parent / "AGENTS.md").exists()
        if bot == "manager-bot":
            assert not (private_pi / "settings.json").exists()
        else:
            browser = json.loads((private_pi / "settings.json").read_text())["pi-browser-use"]
            assert browser["userDataDir"] == str(private_pi / "browser-research")
    assert not (home / ".pi").exists()


@pytest.mark.parametrize("conflict", ["symlink", "resource", "malformed"])
def test_preflight_all_instances_before_any_write(deployment, conflict):
    root, home, env_file = deployment
    pi = home / ".battuta/pi-bots/worker-2/.pi"
    pi.mkdir(parents=True)
    if conflict == "symlink":
        (pi / "mcp.json").symlink_to(env_file)
    else:
        (pi / "settings.json").write_text('{"extensions":["/obsolete/code.js"]}' if conflict == "resource" else "private-sentinel invalid JSON")
    with pytest.raises(click.ClickException) as error:
        release.configure_release(root, env_file=env_file, home=home)
    assert "private-sentinel" not in str(error.value)
    assert not (home / ".battuta/pi-bots/cos-bot").exists()


def test_zero_workers(deployment):
    root, home, env_file = deployment
    env_file.write_text(env_file.read_text().replace("WORKER_BOT_COUNT=2", "WORKER_BOT_COUNT=0"))
    release.configure_release(root, env_file=env_file, home=home)
    assert {p.name for p in (home / ".battuta/pi-bots").iterdir()} == {"cos-bot", "manager-bot"}
