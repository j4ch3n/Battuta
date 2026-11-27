"""Worker instances copy prepared public configuration, never private state."""

import json
import os
from pathlib import Path
import shutil
from unittest.mock import patch

import click
import pytest

from bot_setup.configure import configure_source, configure_worker
from skill_fixtures import manifest_text, write_delegate_templates


class WorkerSource:
    """A source checkout with a worker profile; `prepare` runs source setup with installs stubbed."""

    def __init__(self, root):
        self.root = root
        self.profile = root / "bots/worker"
        self.profile.mkdir(parents=True)
        (root / "bots/AGENTS_shared.md").write_text("shared fixture")
        (self.profile / "AGENTS_dedicated.md").write_text("dedicated fixture")
        (self.profile / "bot.toml").write_text(manifest_text("worker", ["execute-assignment", "research"]))
        for name in ("execute-assignment", "research"):
            skill = root / "skills-hub" / name
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Fixture\n---\n")
        self.home = root / "home"
        self.bot = self.home / ".battuta/pi-bots/worker-1"
        self.env = root / ".env"
        self.env.write_text("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-key\n")
        self.runtime = root / "assignment-worker"
        self.runtime.mkdir(parents=True)
        (self.runtime / "index.ts").write_text("export default () => {};")
        (root / "agent-mail").mkdir()
        (root / "agent-mail/index.ts").write_text("export default () => {};")
        for name in ("mcp", "codemode"):
            path = self.runtime / f"node_modules/@earendil-works/pi-coding-agent/dist/extensions/{name}/index.js"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export default () => {};")
        (self.profile / ".pi").mkdir()
        (self.profile / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture mobile browser"}}')
        write_delegate_templates(self.profile)

    def prepare(self):
        with patch("bot_setup.configure.run") as run:
            configure_source(self.root, role="worker", env_file=self.env)
        return run

    def settings(self, bot=None):
        return json.loads(((bot or self.profile) / ".pi/settings.json").read_text())


@pytest.fixture
def worker(tmp_path, monkeypatch):
    root = tmp_path.resolve()
    monkeypatch.setenv("HOME", str(root / "home"))
    return WorkerSource(root)


def test_source_preparation_registers_shared_native_resources_without_starting_pi(worker):
    run = worker.prepare()
    assert run.called
    settings = worker.settings()
    assert "extensions" not in settings
    assert (worker.profile / ".pi/extensions/assignment-worker.ts").resolve() == worker.runtime / "index.ts"
    assert all((worker.profile / ".pi" / value).exists() for value in settings["skills"])
    assert all(value.startswith("skills/") for value in settings["skills"])
    assert not (worker.profile / ".pi/skills/execute-assignment").is_symlink()
    assert (worker.profile / ".pi/skills/execute-assignment/SKILL.md").is_file()
    assert (Path(os.environ["CLAUDE_CONFIG_DIR"]) / "skills/research/SKILL.md").is_file()


def test_research_preload_has_real_files_and_references(worker):
    research = worker.root / "skills-hub/research"
    (research / "references").mkdir()
    reference = research / "references/evidence.md"
    reference.write_text("Evidence fixture")
    worker.prepare()
    prepared = worker.profile / ".pi/skills/research"
    assert prepared.is_dir()
    assert not prepared.is_symlink()
    assert (prepared / "SKILL.md").read_bytes() == (research / "SKILL.md").read_bytes()
    assert (prepared / "references/evidence.md").read_text() == "Evidence fixture"
    selected = [(worker.profile / ".pi" / path).resolve() for path in worker.settings()["skills"]]
    assert prepared in selected
    assert research not in selected
    reference.write_text("Updated evidence fixture")
    worker.prepare()
    assert (prepared / "references/evidence.md").read_text() == "Evidence fixture"


def test_research_preload_preserves_custom_content(worker):
    worker.prepare()
    prepared = worker.profile / ".pi/skills/research"
    prepared.mkdir(parents=True, exist_ok=True)
    (prepared / "SKILL.md").write_text("Private custom research")
    worker.prepare()
    assert (prepared / "SKILL.md").read_text() == "Private custom research"


def test_research_preload_refuses_symlinked_directory(worker):
    skills = worker.profile / ".pi/skills"
    skills.mkdir()
    outside = worker.root / "custom-skills"
    outside.mkdir()
    (skills / "research").symlink_to(outside, target_is_directory=True)
    with pytest.raises(click.ClickException, match="custom"):
        worker.prepare()
    assert list(outside.iterdir()) == []


def test_copies_prepared_settings_and_instructions_without_installing_or_copying_private_state(worker):
    worker.prepare()
    for file in ("auth.json", "models.json", "sessions/private.jsonl", "mail-sessions/private"):
        path = worker.profile / ".pi" / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source-private")
    for bot in (worker.bot, worker.home / ".battuta/pi-bots/worker-2"):
        with patch("bot_setup.configure.run") as run:
            configure_worker(worker.root, bot_dir=bot, env_file=worker.env)
        run.assert_not_called()
        assert (bot / "AGENTS.md").read_text() == (worker.profile / "AGENTS.md").read_text()
        settings = worker.settings(bot)
        assert settings["pi-browser-use"]["userDataDir"] == str(bot / ".pi/browser-research")
        assert all(Path(value).exists() for value in settings["extensions"])
        assert all((Path(value) / "SKILL.md").is_file() for value in settings["skills"])
        assert all((entry["source"] if isinstance(entry, dict) else entry).startswith("npm:") for entry in settings["packages"])
        assert json.loads((bot / ".pi/web-search.json").read_text()) == {"fetchContent": {"userAgent": "fixture mobile browser"}}
        for private in (".pi/auth.json", ".pi/models.json", ".pi/sessions", ".pi/mail-sessions", "node_modules"):
            assert not (bot / private).exists()
        config = json.loads((bot / ".pi/mcp.json").read_text())["mcpServers"]
        assert "linear" not in config
        assert not config["memory"]["enabled"]
        assert "private-key" not in (bot / ".pi/mcp.json").read_text()


def test_explicit_reconfiguration_preserves_private_settings_and_custom_resources(worker):
    worker.prepare()
    (worker.bot / ".pi/skills/custom").mkdir(parents=True)
    (worker.bot / ".pi/skills/custom/SKILL.md").write_text("private custom")
    (worker.bot / ".pi/auth.json").write_text("private-auth")
    (worker.bot / ".pi/settings.json").write_text(json.dumps({"defaultModel": "private-model", "extensions": ["/private/custom.ts"]}))
    (worker.bot / ".pi/mcp.json").write_text(json.dumps({"mcpServers": {"custom": {"url": "https://example.com"}}}))
    (worker.bot / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"private browser"}}')
    for _ in range(2):
        configure_worker(worker.root, bot_dir=worker.bot)
    settings = worker.settings(worker.bot)
    assert settings["defaultModel"] == "private-model"
    assert settings["extensions"] == ["/private/custom.ts"]
    assert (worker.bot / ".pi/auth.json").read_text() == "private-auth"
    assert (worker.bot / ".pi/skills/custom/SKILL.md").read_text() == "private custom"
    servers = json.loads((worker.bot / ".pi/mcp.json").read_text())["mcpServers"]
    assert "custom" in servers
    assert not servers["memory"]["enabled"]
    assert json.loads((worker.bot / ".pi/web-search.json").read_text()) == {"fetchContent": {"userAgent": "private browser"}}


@pytest.mark.parametrize("case", ["unprepared-profile", "invalid-selection"])
def test_failed_setup_does_not_install_or_write(worker, case):
    if case == "unprepared-profile":
        def attempt():
            configure_worker(worker.root, bot_dir=worker.bot, env_file=worker.env)
        untouched = worker.bot
    else:
        (worker.root / "skills-hub/research/SKILL.md").unlink()
        def attempt():
            configure_source(worker.root, role="worker", env_file=worker.env)
        untouched = worker.profile / "AGENTS.md"
    with patch("bot_setup.configure.run") as run, pytest.raises(click.ClickException):
        attempt()
    run.assert_not_called()
    assert not untouched.exists()


def test_invalid_destination_configuration_fails_before_any_write(worker):
    worker.prepare()
    (worker.bot / ".pi").mkdir(parents=True)
    (worker.bot / ".pi/settings.json").write_text('{"extensions":"invalid"}')
    with pytest.raises(click.ClickException):
        configure_worker(worker.root, bot_dir=worker.bot)
    assert not (worker.bot / "AGENTS.md").exists()
    assert not (worker.bot / ".pi/mcp.json").exists()


def test_symlinked_destination_config_is_not_overwritten(worker):
    worker.prepare()
    (worker.bot / ".pi").mkdir(parents=True)
    private = worker.root / "private.json"
    private.write_text("{}")
    (worker.bot / ".pi/settings.json").symlink_to(private)
    with pytest.raises(click.ClickException):
        configure_worker(worker.root, bot_dir=worker.bot)
    assert private.read_text() == "{}"


def test_reconfiguration_replaces_only_previous_installation_owned_resources(worker):
    worker.prepare()
    configure_worker(worker.root, bot_dir=worker.bot)
    settings_path = worker.bot / ".pi/settings.json"
    settings = json.loads(settings_path.read_text())
    settings["extensions"].append("/private/custom.ts")
    settings_path.write_text(json.dumps(settings))
    second = worker.root / "installation B"
    shutil.copytree(worker.profile, second / "bots/worker")
    shutil.copytree(worker.runtime, second / "assignment-worker")
    shutil.copytree(worker.root / "skills-hub", second / "skills-hub")
    # Both installations still exist; old owned paths must not load alongside B.
    configure_worker(second, bot_dir=worker.bot)
    configured = json.loads(settings_path.read_text())
    for key in ("packages", "skills"):
        paths = [path["source"] if isinstance(path, dict) else path for path in configured[key] if path != "/private/custom.ts"]
        assert paths
        assert all(path.startswith("npm:") or Path(path).is_relative_to(second) for path in paths), paths
    assert "/private/custom.ts" in configured["extensions"]
    configure_worker(second, bot_dir=worker.bot)
    assert json.loads(settings_path.read_text()) == configured
