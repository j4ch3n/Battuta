"""Worker instances copy prepared public configuration, never private state."""
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch

from bot_setup.configure import configure_source, configure_worker


class WorkerSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.profile = self.root / "bots/worker"
        self.profile.mkdir(parents=True)
        (self.root / "bots/AGENTS_shared.md").write_text("shared fixture")
        (self.profile / "AGENTS_dedicated.md").write_text("dedicated fixture")
        (self.profile / "skills.json").write_text(json.dumps({"skills": ["execute-assignment", "research"]}))
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

    def prepare(self):
        with patch("bot_setup.configure.run") as run:
            configure_source(self.root, role="worker", env_file=self.env)
        return run

    def test_source_preparation_registers_shared_native_resources_without_starting_pi(self):
        run = self.prepare()
        self.assertTrue(run.called)
        self.assertTrue(all(call.args[0] == "pnpm" for call in run.call_args_list))
        settings = json.loads((self.profile / ".pi/settings.json").read_text())
        self.assertTrue(any((self.profile / ".pi" / value).resolve() == self.runtime / "index.ts" for value in settings["extensions"]))
        self.assertTrue(all((self.profile / ".pi" / value).exists() for value in settings["skills"]))

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
