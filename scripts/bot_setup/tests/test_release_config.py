"""Release configuration regenerates owned files, never private preferences."""

import json
import os
from pathlib import Path

import click
import pytest

from bot_setup import release
from skill_fixtures import manifest_text, write_delegate_templates


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    root, home = tmp_path / "install", tmp_path / "home"
    env_file = tmp_path / ".env.prod"
    env_file.write_text("BATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_2_TYPE=general\nSUPABASE_URL=https://backend.example\nSUPABASE_SECRET_KEY=private-key\nLINEAR_API_TOKEN=private-linear\nCOS_TELEGRAM_TOKEN=101:private-token\nTELEGRAM_ALLOWED_USER_ID=123\n")
    for role in ("cos-bot", "manager-bot", "worker"):
        bot = root / "bots" / role
        (bot / ".pi/skills").mkdir(parents=True)
        (bot / "bot.toml").write_text(manifest_text(role.removesuffix("-bot"), []))
        if role == "worker":
            (bot / "abilities.json").write_text('{"research": {}}')
            write_delegate_templates(bot)
            (bot / ".pi/skills/research").mkdir()
            (bot / ".pi/skills/research/SKILL.md").write_text("research skill")
        (bot / "AGENTS.md").write_text(role)
        (bot / ".pi/settings.json").write_text("{}")
        (bot / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture"}}')
        if role == "cos-bot":
            (bot / ".pi/telegram.json").write_bytes((Path(__file__).parents[3] / "bots/cos-bot/.pi/telegram.json").read_bytes())
    helper = root / "bots/_shared/memory-client/dist/configure-scheduler.js"
    helper.parent.mkdir(parents=True)
    helper.touch()
    helper.with_name("configure-dream.js").touch()
    monkeypatch.setattr(release, "run", lambda *args, **kwargs: None)
    registrations.clear()
    monkeypatch.setattr(release, "register_doc_service", lambda home, *, deployment: registrations.append(deployment) or True)
    return root, home, env_file


registrations = []


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
            assert servers["assignments"]["headers"] == {
                "apikey": "${SUPABASE_SECRET_KEY}",
                "X-Battuta-Projects-Root": "${BATTUTA_PROJECTS_ROOT_HEADER}",
            }
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


def test_release_shares_research_skill_with_claude_code_once(deployment):
    root, home, env_file = deployment
    skill = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "skills/research/SKILL.md"
    release.configure_release(root, env_file=env_file, home=home)
    assert skill.read_text() == "research skill"
    skill.write_text("customized")
    release.configure_release(root, env_file=env_file, home=home)
    assert skill.read_text() == "customized"


def test_main_release_registers_document_service_once_per_run(deployment):
    root, home, env_file = deployment
    release.configure_release(root, env_file=env_file, home=home)
    assert registrations == ["main"]


def test_release_generated_mcp_wins_over_shipped_worker_template(deployment):
    root, home, env_file = deployment
    (root / "bots/worker/.pi/mcp.json").write_text('{"mcpServers":{"stale":{}}}')
    release.configure_release(root, env_file=env_file, home=home)
    servers = json.loads((home / ".battuta/pi-bots/worker-1/.pi/mcp.json").read_text())["mcpServers"]
    assert "stale" not in servers
    assert "assignments" in servers


def test_release_merges_cos_telegram_handler_without_overwriting_existing_values(deployment):
    root, home, env_file = deployment
    pi = home / ".battuta/pi-bots/cos-bot/.pi"
    release.configure_release(root, env_file=env_file, home=home)
    fresh = json.loads((pi / "telegram.json").read_text())
    assert fresh["profiles"]["default"]["botToken"] == "${COS_TELEGRAM_TOKEN}"
    assert fresh["outboundHandlers"][0]["output"] == "ogg"
    (pi / "telegram.json").write_text(json.dumps({"custom": True, "profiles": {"default": {"botToken": "${COS_TELEGRAM_TOKEN}", "allowedUserId": 1}}}))
    release.configure_release(root, env_file=env_file, home=home)
    merged = json.loads((pi / "telegram.json").read_text())
    assert merged["custom"] is True
    assert merged["profiles"] == {"default": {"botToken": "${COS_TELEGRAM_TOKEN}", "allowedUserId": 1}}
    assert merged["outboundHandlers"] == fresh["outboundHandlers"]


def test_fresh_release_defaults_survive_browser_setup(deployment):
    root, home, env_file = deployment
    release.configure_release(root, env_file=env_file, home=home)
    for bot, thinking in (("cos-bot", "low"), ("manager-bot", "medium"), ("worker-1", "medium"), ("worker-2", "medium")):
        settings = json.loads((home / ".battuta/pi-bots" / bot / ".pi/settings.json").read_text())
        assert settings["defaultThinkingLevel"] == thinking


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
    env_file.write_text(env_file.read_text().replace("BATTUTA_WORKER_1_TYPE=general\nBATTUTA_WORKER_2_TYPE=general\n", ""))
    release.configure_release(root, env_file=env_file, home=home)
    assert {p.name for p in (home / ".battuta/pi-bots").iterdir()} == {"cos-bot", "manager-bot"}


def test_influencer_release_configures_only_worker(deployment):
    root, home, env_file = deployment
    profile = root / "bots/worker-influencer"
    profile.mkdir()
    (profile / ".pi").mkdir()
    source = Path(__file__).parents[3] / "bots/worker-influencer/bot.toml"
    (profile / "bot.toml").write_text(source.read_text())
    (profile / "abilities.json").write_text('{"mobile-control": {}}')
    (profile / "AGENTS.md").write_text("worker")
    (profile / ".pi/settings.json").write_text("{}")
    cos = home / ".battuta/pi-bots/cos-bot/.pi"
    cos.mkdir(parents=True)
    (cos / "auth.json").write_text("existing")
    env_file.write_text("BATTUTA_WORKER_1_TYPE=influencer\nSUPABASE_URL=https://backend.example\nSUPABASE_SECRET_KEY=private\n")
    release.configure_release(root, env_file=env_file, home=home, deployment="influencer")
    assert {p.name for p in (home / ".battuta/pi-bots").iterdir()} == {"cos-bot", "worker-1"}
    assert (cos / "auth.json").read_text() == "existing"
    assert not (cos / "mcp.json").exists()
    assert (home / ".battuta/pi-bots/worker-1/.pi/mcp.json").is_file()


@pytest.mark.parametrize("selection", ["", "BATTUTA_WORKER_1_TYPE=general\n", "BATTUTA_WORKER_1_TYPE=influencer\nBATTUTA_WORKER_2_TYPE=influencer\n"])
def test_influencer_release_rejects_invalid_selection_before_writes(deployment, selection):
    root, home, env_file = deployment
    env_file.write_text(selection)
    with pytest.raises(click.ClickException):
        release.configure_release(root, env_file=env_file, home=home, deployment="influencer")
    assert not home.exists()
