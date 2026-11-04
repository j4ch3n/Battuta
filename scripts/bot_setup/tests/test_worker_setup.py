"""Worker setup separates private instances from shared runtime/resources."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bot_setup.configure import configure_source


class WorkerSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "bots/worker").mkdir(parents=True)
        (self.root / "bots/AGENTS_shared.md").write_text("shared fixture")
        (self.root / "bots/worker/AGENTS_dedicated.md").write_text("dedicated fixture")
        (self.root / "bots/worker/skills.json").write_text(json.dumps({"skills": ["execute-assignment", "memory"]}))
        for name in ("execute-assignment", "memory"):
            skill = self.root / "skills-hub" / name
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Fixture\n---\n")
        self.bot = self.root / "private instance"
        (self.bot / ".pi/skills/custom").mkdir(parents=True)
        (self.bot / ".pi/skills/custom/SKILL.md").write_text("private custom")
        (self.bot / ".pi/auth.json").write_text("private-auth")
        self.env = self.root / ".env"
        self.env.write_text("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=private-key\n")
        self.runtime = self.root / "assignment-worker"
        for name in ("mcp", "codemode"):
            path = self.runtime / f"node_modules/@earendil-works/pi-coding-agent/dist/extensions/{name}/index.js"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export default () => {};")

    def test_worker_configures_without_linear_or_telegram_and_preserves_private_state(self):
        with patch("bot_setup.configure.run") as run:
            for _ in range(2):
                configure_source(self.root, role="worker", bot_dir=self.bot, env_file=self.env)
        self.assertIn("dedicated fixture", (self.bot / "AGENTS.md").read_text())
        self.assertTrue((self.bot / ".pi/skills/execute-assignment").is_symlink())
        self.assertEqual((self.bot / ".pi/auth.json").read_text(), "private-auth")
        self.assertEqual((self.bot / ".pi/skills/custom/SKILL.md").read_text(), "private custom")
        config = json.loads((self.bot / ".pi/mcp.json").read_text())["mcpServers"]
        self.assertNotIn("linear", config)
        self.assertEqual(config["memory"]["exposure"], "hidden")
        self.assertNotIn("memory_remember", config["memory"]["toolExposure"])
        self.assertNotIn("private-key", (self.bot / ".pi/mcp.json").read_text())
        self.assertTrue(any(str(self.runtime) in str(call) for call in run.call_args_list))
        self.assertFalse((self.bot / "package.json").exists())

    def test_invalid_selection_fails_before_installation_or_configuration_writes(self):
        (self.root / "skills-hub/memory/SKILL.md").unlink()
        with patch("bot_setup.configure.run") as run, self.assertRaises(Exception):
            configure_source(self.root, role="worker", bot_dir=self.bot, env_file=self.env)
        run.assert_not_called()
        self.assertFalse((self.bot / "AGENTS.md").exists())

    def test_selected_research_tools_are_installed_once_in_shared_runtime_not_instances(self):
        skill = self.root / "skills-hub/research"
        skill.mkdir()
        (skill / "SKILL.md").write_text("research fixture")
        (self.root / "bots/worker/skills.json").write_text(json.dumps({"skills": ["execute-assignment", "memory", "research"]}))
        web = self.runtime / ".pi/npm/node_modules/pi-web-access"
        web.mkdir(parents=True)
        (web / "package.json").write_text('{"name":"pi-web-access"}')
        with patch("bot_setup.configure.run") as run:
            configure_source(self.root, role="worker", bot_dir=self.bot, env_file=self.env)
        installs = [call for call in run.call_args_list if "-l" in call.args]
        self.assertEqual(len(installs), 1)
        self.assertEqual(installs[0].kwargs["cwd"], self.runtime)
        self.assertIn(str(web), json.loads((self.bot / ".pi/settings.json").read_text())["packages"])
        self.assertFalse((self.bot / "node_modules").exists())

if __name__ == "__main__":
    unittest.main()
