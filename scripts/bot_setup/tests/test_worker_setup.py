"""Worker instances copy prepared public configuration, never private state."""
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch

from bot_setup.configure import configure_source, configure_worker
from skill_fixtures import manifest_text


class WorkerSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.profile = self.root / "bots/worker"
        self.profile.mkdir(parents=True)
        (self.root / "bots/AGENTS_shared.md").write_text("shared fixture")
        (self.profile / "AGENTS_dedicated.md").write_text("dedicated fixture")
        (self.profile / "bot.toml").write_text(manifest_text("worker", ["execute-assignment", "research"]))
        for name in ("execute-assignment", "research"):
            skill = self.root / "skills-hub" / name
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Fixture\n---\n")
        self.home = self.root / "home"
        home = patch.dict("os.environ", {"HOME": str(self.home)})
        home.start()
        self.addCleanup(home.stop)
        self.bot = self.home / ".battuta/pi-bots/worker-1"
        self.env = self.root / ".env"
        self.env.write_text("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-key\n")
        self.runtime = self.profile / "extension/assignment-worker"
        self.runtime.mkdir(parents=True)
        (self.runtime / "index.ts").write_text("export default () => {};")
        for name in ("mcp", "codemode"):
            path = self.runtime / f"node_modules/@earendil-works/pi-coding-agent/dist/extensions/{name}/index.js"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export default () => {};")
        (self.profile / ".pi").mkdir()
        (self.profile / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"fixture mobile browser"}}')
        (self.profile / "agents").mkdir()
        (self.profile / "agents/researcher.md").write_text("---\nname: researcher\n---\nResearch fixture.")
        (self.profile / "agents/reviewer.md").write_text("---\nname: reviewer\n---\nReview fixture.")

    def prepare(self):
        with patch("bot_setup.configure.run") as run:
            configure_source(self.root, role="worker", env_file=self.env)
        return run

    def test_source_preparation_registers_shared_native_resources_without_starting_pi(self):
        run = self.prepare()
        self.assertTrue(run.called)
        self.assertTrue(any(call.args[0] == str(self.runtime / "node_modules/.bin/pi") and call.args[-1] == "npm:@tintinweb/pi-subagents@0.24.0" for call in run.call_args_list))
        settings = json.loads((self.profile / ".pi/settings.json").read_text())
        self.assertTrue(any((self.profile / ".pi" / value).resolve() == self.runtime / "index.ts" for value in settings["extensions"]))
        self.assertTrue(all((self.profile / ".pi" / value).exists() for value in settings["skills"]))
        self.assertIn("npm:@tintinweb/pi-subagents@0.24.0", settings["packages"])
        researcher = (self.profile / ".pi/agents/researcher.md").read_text()
        reviewer = (self.profile / ".pi/agents/reviewer.md").read_text()
        self.assertIn('skills: ["research"]', researcher)
        self.assertIn('extensions: ["pi-web-access"]', researcher)
        self.assertIn("skills: false", reviewer)
        self.assertIn("extensions: false", reviewer)

    def test_invalid_subagent_configuration_fails_before_install_or_writes(self):
        manifest = self.profile / "bot.toml"
        original = manifest.read_text()
        for old, new in [
            ('agents/researcher.md', '../outside.md'),
            ('agents/researcher.md', 'agents/missing.md'),
            ('inherit_parent_skills = ["research"]', 'inherit_parent_skills = ["missing"]'),
            ('extensions = ["pi-web-access"]', 'extensions = ["uninstalled"]'),
            ('agents/reviewer.md', 'agents/researcher.md'),
        ]:
            with self.subTest(change=new):
                manifest.write_text(original.replace(old, new))
                with patch("bot_setup.configure.run") as run, self.assertRaises(Exception):
                    configure_source(self.root, role="worker", env_file=self.env)
                run.assert_not_called()
                self.assertFalse((self.profile / "AGENTS.md").exists())
        manifest.write_text(original)

    def test_conflicting_prompt_frontmatter_fails_before_writes(self):
        prompt = self.profile / "agents/researcher.md"
        prompt.write_text("---\nname: researcher\nskills: other\n---\nFixture")
        with patch("bot_setup.configure.run") as run, self.assertRaises(Exception):
            configure_source(self.root, role="worker", env_file=self.env)
        run.assert_not_called()
        self.assertFalse((self.profile / "AGENTS.md").exists())

    def test_prompt_paths_are_profile_relative_and_symlinks_are_rejected(self):
        manifest = self.profile / "bot.toml"
        manifest.write_text(manifest.read_text().replace("agents/researcher.md", "prompts/custom.md"))
        prompt = self.profile / "prompts/custom.md"
        prompt.parent.mkdir()
        prompt.write_text("---\nname: researcher\n---\nCustom location")
        self.prepare()
        assert "Custom location" in (self.profile / ".pi/agents/custom.md").read_text()
        prompt.unlink()
        prompt.symlink_to(self.profile / "agents/researcher.md")
        with patch("bot_setup.configure.run") as run, self.assertRaises(Exception):
            configure_source(self.root, role="worker", env_file=self.env)
        run.assert_not_called()

    def test_agent_updates_preserve_custom_definitions_and_private_state(self):
        self.prepare()
        configure_worker(self.root, bot_dir=self.bot)
        custom = self.bot / ".pi/agents/custom.md"
        custom.write_text("Custom definition")
        (self.profile / "agents/researcher.md").write_text("---\nname: researcher\n---\nUpdated researcher")
        self.prepare()
        configure_worker(self.root, bot_dir=self.bot)
        self.assertIn("Updated researcher", (self.bot / ".pi/agents/researcher.md").read_text())
        self.assertEqual(custom.read_text(), "Custom definition")
        (self.bot / ".pi/agents/researcher.md").write_text("Private customization")
        with self.assertRaisesRegex(Exception, "custom subagent"):
            configure_worker(self.root, bot_dir=self.bot)

    def test_research_preload_has_real_files_and_references(self):
        research = self.root / "skills-hub/research"
        (research / "references").mkdir()
        reference = research / "references/evidence.md"
        reference.write_text("Evidence fixture")
        self.prepare()
        prepared = self.profile / ".pi/skills/research"
        self.assertTrue(prepared.is_dir())
        self.assertFalse(prepared.is_symlink())
        self.assertEqual((prepared / "SKILL.md").read_bytes(), (research / "SKILL.md").read_bytes())
        self.assertEqual((prepared / "references/evidence.md").read_text(), "Evidence fixture")
        settings = json.loads((self.profile / ".pi/settings.json").read_text())
        selected = [(self.profile / ".pi" / path).resolve() for path in settings["skills"]]
        self.assertIn(prepared, selected)
        self.assertNotIn(research, selected)
        reference.write_text("Updated evidence fixture")
        self.prepare()
        self.assertEqual((prepared / "references/evidence.md").read_text(), "Updated evidence fixture")

    def test_research_preload_preserves_custom_content(self):
        self.prepare()
        prepared = self.profile / ".pi/skills/research"
        prepared.mkdir(parents=True, exist_ok=True)
        (prepared / "SKILL.md").write_text("Private custom research")
        with self.assertRaisesRegex(Exception, "custom"):
            self.prepare()
        self.assertEqual((prepared / "SKILL.md").read_text(), "Private custom research")

    def test_research_preload_refuses_symlinked_directory(self):
        skills = self.profile / ".pi/skills"
        skills.mkdir()
        outside = self.root / "custom-skills"
        outside.mkdir()
        (skills / "research").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(Exception, "custom"):
            self.prepare()
        self.assertEqual(list(outside.iterdir()), [])

    def test_copies_prepared_settings_and_instructions_without_installing_or_copying_private_state(self):
        self.prepare()
        for file in ("auth.json", "models.json", "sessions/private.jsonl", "mail-sessions/private"):
            path = self.profile / ".pi" / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("source-private")
        for bot in (self.bot, self.home / ".battuta/pi-bots/worker-2"):
            with patch("bot_setup.configure.run") as run:
                configure_worker(self.root, bot_dir=bot, env_file=self.env)
            run.assert_not_called()
            self.assertEqual((bot / "AGENTS.md").read_text(), (self.profile / "AGENTS.md").read_text())
            settings = json.loads((bot / ".pi/settings.json").read_text())
            self.assertEqual(settings["pi-browser-use"]["userDataDir"], str(bot / ".pi/browser-research"))
            self.assertTrue(all(Path(value).exists() for value in settings["extensions"]))
            self.assertTrue(all((Path(value) / "SKILL.md").is_file() for value in settings["skills"]))
            self.assertTrue(all(value.startswith("npm:") for value in settings["packages"]))
            self.assertEqual(json.loads((bot / ".pi/web-search.json").read_text()), {"fetchContent": {"userAgent": "fixture mobile browser"}})
            self.assertFalse((bot / ".pi/auth.json").exists())
            self.assertFalse((bot / ".pi/models.json").exists())
            self.assertFalse((bot / ".pi/sessions").exists())
            self.assertFalse((bot / ".pi/mail-sessions").exists())
            self.assertFalse((bot / "node_modules").exists())
            config = json.loads((bot / ".pi/mcp.json").read_text())["mcpServers"]
            self.assertNotIn("linear", config)
            self.assertFalse(config["memory"]["enabled"])
            self.assertNotIn("private-key", (bot / ".pi/mcp.json").read_text())

    def test_explicit_reconfiguration_preserves_private_settings_and_custom_resources(self):
        self.prepare()
        (self.bot / ".pi/skills/custom").mkdir(parents=True)
        (self.bot / ".pi/skills/custom/SKILL.md").write_text("private custom")
        (self.bot / ".pi/auth.json").write_text("private-auth")
        (self.bot / ".pi/settings.json").write_text(json.dumps({"defaultModel": "private-model", "extensions": ["/private/custom.ts"]}))
        (self.bot / ".pi/mcp.json").write_text(json.dumps({"mcpServers": {"custom": {"url": "https://example.com"}}}))
        (self.bot / ".pi/web-search.json").write_text('{"fetchContent":{"userAgent":"private browser"}}')
        for _ in range(2):
            configure_worker(self.root, bot_dir=self.bot)
        settings = json.loads((self.bot / ".pi/settings.json").read_text())
        self.assertEqual(settings["defaultModel"], "private-model")
        self.assertEqual(settings["extensions"].count(str(self.runtime / "index.ts")), 1)
        self.assertIn("/private/custom.ts", settings["extensions"])
        self.assertEqual((self.bot / ".pi/auth.json").read_text(), "private-auth")
        self.assertEqual((self.bot / ".pi/skills/custom/SKILL.md").read_text(), "private custom")
        self.assertIn("custom", json.loads((self.bot / ".pi/mcp.json").read_text())["mcpServers"])
        self.assertFalse(json.loads((self.bot / ".pi/mcp.json").read_text())["mcpServers"]["memory"]["enabled"])
        self.assertEqual(json.loads((self.bot / ".pi/web-search.json").read_text()), {"fetchContent": {"userAgent": "private browser"}})

    def test_unprepared_profile_fails_without_writing_or_installing(self):
        with patch("bot_setup.configure.run") as run, self.assertRaises(Exception):
            configure_worker(self.root, bot_dir=self.bot, env_file=self.env)
        run.assert_not_called()
        self.assertFalse(self.bot.exists())

    def test_invalid_selection_fails_before_installation_or_configuration_writes(self):
        (self.root / "skills-hub/research/SKILL.md").unlink()
        with patch("bot_setup.configure.run") as run, self.assertRaises(Exception):
            configure_source(self.root, role="worker", env_file=self.env)
        run.assert_not_called()
        self.assertFalse((self.profile / "AGENTS.md").exists())

    def test_invalid_destination_configuration_fails_before_any_write(self):
        self.prepare()
        (self.bot / ".pi").mkdir(parents=True)
        (self.bot / ".pi/settings.json").write_text('{"extensions":"invalid"}')
        with self.assertRaises(Exception):
            configure_worker(self.root, bot_dir=self.bot)
        self.assertFalse((self.bot / "AGENTS.md").exists())
        self.assertFalse((self.bot / ".pi/mcp.json").exists())

    def test_symlinked_destination_config_is_not_overwritten(self):
        self.prepare()
        (self.bot / ".pi").mkdir(parents=True)
        private = self.root / "private.json"
        private.write_text("{}")
        (self.bot / ".pi/settings.json").symlink_to(private)
        with self.assertRaises(Exception):
            configure_worker(self.root, bot_dir=self.bot)
        self.assertEqual(private.read_text(), "{}")

    def test_reconfiguration_replaces_only_previous_installation_owned_resources(self):
        self.prepare()
        configure_worker(self.root, bot_dir=self.bot)
        settings_path = self.bot / ".pi/settings.json"
        settings = json.loads(settings_path.read_text())
        settings["extensions"].append("/private/custom.ts")
        settings_path.write_text(json.dumps(settings))
        second = self.root / "installation B"
        shutil.copytree(self.profile, second / "bots/worker")
        shutil.copytree(self.root / "skills-hub", second / "skills-hub")
        # Both installations still exist; old owned paths must not load alongside B.
        configure_worker(second, bot_dir=self.bot)
        configured = json.loads(settings_path.read_text())
        for key in ("extensions", "packages", "skills"):
            paths = [path for path in configured[key] if path != "/private/custom.ts"]
            self.assertTrue(paths)
            self.assertTrue(all(path.startswith("npm:") or Path(path).is_relative_to(second) for path in paths), paths)
        self.assertIn("/private/custom.ts", configured["extensions"])
        configure_worker(second, bot_dir=self.bot)
        self.assertEqual(json.loads(settings_path.read_text()), configured)


if __name__ == "__main__":
    unittest.main()
