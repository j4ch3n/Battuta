"""Linear MCP uses the same credential environment as project-context."""

from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import sys
from unittest.mock import patch

import click

from fixtures import ConfigFixture

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.mcp import configure_mcp  # noqa: E402


class MCPConfigTests(ConfigFixture):
    def test_configures_token_environment_without_writing_secret(self):
        bot = self.root / "bots/pm-bot"
        with redirect_stdout(StringIO()):
            configure_mcp(bot, self.root / ".env", {"LINEAR_API_TOKEN": "private-token"}, role="pm")
        config = (bot / ".pi/mcp.json").read_text()
        self.assertIn("linear", json.loads(config)["mcpServers"])
        self.assertIn("memory", json.loads(config)["mcpServers"])
        self.assertNotIn("private-token", config)
        self.assertFalse((bot / ".pi/mcp-auth.json").exists())

    def test_missing_token_reports_required_name(self):
        with self.assertRaises(click.ClickException) as caught:
            configure_mcp(self.root / "bots/pm-bot", self.root / ".env", {}, role="pm")
        self.assertIn("LINEAR_API_TOKEN", str(caught.exception))

    def test_shared_helper_validation_errors_reach_python_without_leaking_input(self):
        bot = self.root / "bots/pm-bot"
        with self.assertRaisesRegex(click.ClickException, "loopback HTTP") as caught:
            configure_mcp(bot, self.root / ".env", {
                "LINEAR_API_TOKEN": "private-token",
                "BATTUTA_MEMORY_URL": "http://user:private-password@localhost/mcp",
            }, role="pm")
        self.assertNotIn("private-password", str(caught.exception))
        self.assertFalse((bot / ".pi/mcp.json").exists())

    def test_corrupt_config_is_preserved_without_echoing_private_json(self):
        bot = self.root / "bots/pm-bot"
        path = bot / ".pi/mcp.json"
        original = '{"private":"secret-value",broken}'
        path.write_text(original)
        with self.assertRaisesRegex(click.ClickException, "Invalid JSON") as caught:
            configure_mcp(bot, self.root / ".env", {"LINEAR_API_TOKEN": "private-token"}, role="pm")
        self.assertNotIn("secret-value", str(caught.exception))
        self.assertEqual(path.read_text(), original)

    def test_missing_node_reports_setup_failure_without_writing_config(self):
        bot = self.root / "bots/pm-bot"
        with patch("bot_setup.mcp.subprocess.run", side_effect=FileNotFoundError("node is unavailable")):
            with self.assertRaisesRegex(click.ClickException, "node is unavailable"):
                configure_mcp(bot, self.root / ".env", {"LINEAR_API_TOKEN": "private-token"}, role="pm")
        self.assertFalse((bot / ".pi/mcp.json").exists())

    def test_luma_is_pm_only_in_custom_workspaces_and_preserves_oauth_state(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role):
                bot = self.root / f"custom-{role}-workspace"
                (bot / ".pi").mkdir(parents=True)
                config = bot / ".pi/mcp.json"
                config.write_text(json.dumps({"mcpServers": {"other": {"command": "other-server"}}}))
                auth = bot / ".pi/mcp-auth.json"
                credential = b'{"sentinel":"private-oauth-token"}\n'
                auth.write_bytes(credential)
                auth.chmod(0o600)
                output = StringIO()
                for _ in range(2):
                    with redirect_stdout(output):
                        configure_mcp(bot, self.root / ".env", {"LINEAR_API_TOKEN": "private-token"}, role=role)
                    data = json.loads(config.read_text())
                    servers = data["mcpServers"]
                    self.assertEqual(servers["other"], {"command": "other-server"})
                    self.assertEqual(auth.read_bytes(), credential)
                    self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
                    self.assertNotIn("private-oauth-token", config.read_text() + output.getvalue())
                    self.assertEqual("luma" in servers, role == "pm")
