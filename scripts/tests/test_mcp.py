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
        self.assertEqual(json.loads(config)["mcpServers"]["linear"]["bearerTokenEnv"],
                         "LINEAR_API_TOKEN")
        self.assertNotIn("private-token", config)

    def test_missing_token_reports_required_name(self):
        with self.assertRaises(click.ClickException) as caught:
            configure_mcp(self.root / "bots/pm-bot", self.root / ".env", {})
        self.assertIn("LINEAR_API_TOKEN", str(caught.exception))
