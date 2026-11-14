"""Release configuration regenerates owned files, never private preferences."""

import json

import click
import pytest

from bot_setup import release
from skill_fixtures import manifest_text


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    root, home = tmp_path / "install", tmp_path / "home"
    env_file = tmp_path / ".env.prod"
    env_file.write_text("WORKER_BOT_COUNT=2\nSUPABASE_URL=https://backend.example\nSUPABASE_SECRET_KEY=private-key\nLINEAR_API_TOKEN=private-linear\nCOS_TELEGRAM_TOKEN=101:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n")
    for role in ("cos-bot", "manager-bot", "worker"):
        bot = root / "bots" / role
        (bot / ".pi/skills").mkdir(parents=True)
        (bot / "bot.toml").write_text(manifest_text(role.removesuffix("-bot"), []))
        (bot / "AGENTS.md").write_text(role)
        (bot / ".pi/settings.json").write_text("{}")
        (bot / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture"}}')
    helper = root / "bots/_shared/memory-client/dist/configure-scheduler.js"
    helper.parent.mkdir(parents=True)
    helper.touch()
    helper.with_name("configure-dream.js").touch()
    monkeypatch.setattr(release, "run", lambda *args, **kwargs: None)
    return root, home, env_file


def test_release_provisions_dream_before_scheduler_initialization(deployment, monkeypatch):
    root, home, env_file = deployment
    calls = []
    monkeypatch.setattr(release, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    release.configure_release(root, env_file=env_file, home=home)
    args, kwargs = calls[0]
    assert args == ("node", str(root / "bots/_shared/memory-client/dist/configure-dream.js"), str(root / "bots/cos-bot"), "--release")
    assert kwargs["env"]["PI_CODING_AGENT_DIR"] == str(home / ".battuta/pi-bots/cos-bot/.pi")


def test_release_preserves_existing_files_and_reports_skips(deployment, capsys):
    root, home, env_file = deployment
    pi = home / ".battuta/pi-bots/cos-bot/.pi"
    pi.mkdir(parents=True)
    private = {"settings.json": '{"defaultModel":"personal","theme":"light"}', "auth.json": "opaque-auth", "models.json": "opaque-models", "sessions/session.jsonl": "opaque-session", "mcp-auth.json": "opaque-oauth"}
    for name, data in private.items():
        path = pi / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(data)
    (pi / "mcp.json").write_text('{"mcpServers":{"obsolete":{}}}')
    mcp = (pi / "mcp.json").read_bytes()
    release.configure_release(root, env_file=env_file, home=home)
    output = capsys.readouterr().out
    assert (pi / "settings.json").read_text() == private["settings.json"]
    assert (pi / "mcp.json").read_bytes() == mcp
    assert str(pi / "settings.json") in output
    assert str(pi / "mcp.json") in output
    assert "skipped" in output.lower()
    assert {name: (pi / name).read_text() for name in private if name != "settings.json"} == {name: data for name, data in private.items() if name != "settings.json"}
    for bot in ("cos-bot", "manager-bot", "worker-1", "worker-2"):
        private_pi = home / ".battuta/pi-bots" / bot / ".pi"
        servers = json.loads((private_pi / "mcp.json").read_text())["mcpServers"]
        if bot != "cos-bot":
            assert servers["assignments"]["headers"] == {"apikey": "${SUPABASE_SECRET_KEY}"}
        assert (private_pi / "telegram.json").exists() == (bot == "cos-bot")
        if bot != "cos-bot":
            assert (private_pi / "mcp.json").stat().st_mode & 0o777 == 0o600
        assert not (private_pi.parent / "AGENTS.md").exists()
        if bot == "manager-bot":
            assert json.loads((private_pi / "settings.json").read_text())["defaultThinkingLevel"] == "medium"
        elif bot != "cos-bot":
            browser = json.loads((private_pi / "settings.json").read_text())["pi-browser-use"]
            assert browser["userDataDir"] == str(private_pi / "browser-research")
    assert not (home / ".pi").exists()


def test_fresh_release_defaults_survive_browser_setup(deployment):
    root, home, env_file = deployment
    release.configure_release(root, env_file=env_file, home=home)
    for bot, thinking in (("cos-bot", "low"), ("manager-bot", "medium"), ("worker-1", "high"), ("worker-2", "high")):
        settings = json.loads((home / ".battuta/pi-bots" / bot / ".pi/settings.json").read_text())
        assert settings["defaultThinkingLevel"] == thinking
        assert settings["defaultModel"]


def test_repeated_release_leaves_created_files_unchanged(deployment, capsys):
    root, home, env_file = deployment
    release.configure_release(root, env_file=env_file, home=home)
    paths = list((home / ".battuta/pi-bots").rglob("*.json"))
    before = {path: path.read_bytes() for path in paths}
    capsys.readouterr()
    release.configure_release(root, env_file=env_file, home=home)
    assert {path: path.read_bytes() for path in paths} == before
    output = capsys.readouterr().out
    assert all(str(path) in output for path in paths)


def test_existing_browser_preferences_are_left_untouched(deployment, capsys):
    root, home, env_file = deployment
    path = home / ".battuta/pi-bots/cos-bot/.pi/settings.json"
    path.parent.mkdir(parents=True)
    original = '{"pi-browser-use":{"headless":false}}'
    path.write_text(original)
    release.configure_release(root, env_file=env_file, home=home)
    assert path.read_text() == original
    assert "browser" in capsys.readouterr().out.lower()

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
