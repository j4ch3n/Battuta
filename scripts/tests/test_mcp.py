"""Linear MCP uses the same credential environment as project-context."""

from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import sys

import click

from fixtures import ConfigFixture

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.mcp import configure_mcp  # noqa: E402


class MCPConfigTests(ConfigFixture):
    def test_configures_token_environment_without_writing_secret(self):
        bot = self.root / "bots/pm-bot"
        with redirect_stdout(StringIO()):
            configure_mcp(bot, self.root / ".env", {"LINEAR_API_TOKEN": "private-token"})
        config = (bot / ".pi/mcp.json").read_text()
        self.assertEqual(json.loads(config)["mcpServers"]["linear"]["headers"],
                         {"Authorization": "Bearer ${LINEAR_API_TOKEN}"})
        self.assertEqual(json.loads(config)["mcpServers"]["linear"]["exposure"], "codemode")
        self.assertNotIn("private-token", config)

    def test_migrates_adapter_config_and_preserves_unrelated_settings(self):
        for role in ("pm", "tl"):
            for package in ("npm:pi-mcp-adapter@2.37.0", {"source": "npm:pi-mcp-adapter", "extensions": ["index.ts"]}):
                with self.subTest(role=role, package=package):
                    bot = self.root / f"bots/{role}-bot"
                    config = bot / ".pi/mcp.json"
                    config.write_text(json.dumps({"custom": True, "mcpServers": {
                        "linear": {"url": "https://mcp.linear.app/mcp", "auth": "bearer", "bearerTokenEnv": "LINEAR_API_TOKEN"},
                        "other": {"command": "other-server"},
                    }}))
                    settings = bot / ".pi/settings.json"
                    settings.write_text(json.dumps({"theme": "dark", "packages": [
                        "npm:@llblab/pi-telegram@0.50.1", package, "npm:pi-web-access@0.35.0",
                        {"source": "npm:custom-tools@1.0.0", "extensions": ["read.ts"]},
                        "npm:pi-mcp-adapter-extra@1.0.0",
                    ]}))
                    with redirect_stdout(StringIO()):
                        for _ in range(2):
                            configure_mcp(bot, self.root / ".env", {"LINEAR_API_TOKEN": "private-token"})
                    data = json.loads(config.read_text())
                    self.assertEqual(data["mcpServers"]["linear"]["headers"], {"Authorization": "Bearer ${LINEAR_API_TOKEN}"})
                    self.assertNotIn("auth", data["mcpServers"]["linear"])
                    self.assertNotIn("bearerTokenEnv", data["mcpServers"]["linear"])
                    self.assertEqual(data["mcpServers"]["other"], {"command": "other-server"})
                    self.assertTrue(data["custom"])
                    self.assertEqual(json.loads(settings.read_text()), {"theme": "dark", "packages": [
                        "npm:@llblab/pi-telegram@0.50.1", "npm:pi-web-access@0.35.0",
                        {"source": "npm:custom-tools@1.0.0", "extensions": ["read.ts"]},
                        "npm:pi-mcp-adapter-extra@1.0.0",
                    ]})

    def test_missing_token_reports_required_name(self):
        with self.assertRaises(click.ClickException) as caught:
            configure_mcp(self.root / "bots/pm-bot", self.root / ".env", {})
        self.assertIn("LINEAR_API_TOKEN", str(caught.exception))
