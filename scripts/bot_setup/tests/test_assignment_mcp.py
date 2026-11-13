"""Assignment MCP endpoint validation and shared profile configuration."""

import json

import click
import pytest

from bot_setup.mcp import configure_mcp


@pytest.mark.parametrize("role", ["cos", "manager", "worker"])
@pytest.mark.parametrize("url", ["https://example.supabase.co", "http://127.0.0.1:54321", "http://localhost:54321/"])
def test_assignment_mcp_preserves_custom_auth_and_role_appropriate_access(tmp_path, role, url):
    pi = tmp_path / ".pi"
    pi.mkdir()
    (pi / "mcp.json").write_text('{"custom":true,"mcpServers":{"other":{"command":"custom"}}}')
    (pi / "mcp-auth.json").write_bytes(b'private-auth')
    for _ in range(2):
        configure_mcp(tmp_path, role=role, supabase_url=url)
    data = json.loads((pi / "mcp.json").read_text())
    server = data["mcpServers"]["assignments"]
    assert server["url"] == url.rstrip("/") + "/functions/v1/assignments"
    assert server["headers"] == {"apikey": "${SUPABASE_SECRET_KEY}"}
    assert server["exposure"] == ("hidden" if role == "worker" else "codemode")
    assert data["custom"] is True
    assert data["mcpServers"]["other"] == {"command": "custom"}
    assert (pi / "mcp-auth.json").read_bytes() == b'private-auth'
    assert (pi / "mcp.json").stat().st_mode & 0o777 == 0o600
    if role == "worker":
        assert "claim_assignment" not in server["toolExposure"]
        assert "get_assignment" in server["toolExposure"]
        assert data["mcpServers"]["memory"]["enabled"] is False
        assert set(data["mcpServers"]) == {"other", "assignments", "memory", "speech"}
        assert not (pi / "settings.json").exists()


@pytest.mark.parametrize("url", ["", "invalid", "http://example.com", "https://user:private-password@example.com", "https://example.com?secret=private-password", "https://example.com/#fragment", "https://example.com/path", "https://exa mple.com", "https://example.com\\path", "https://example.com/\n", "https://bad_host.example", "https://-bad.example"])
def test_bad_assignment_endpoint_fails_before_writes(tmp_path, url):
    with pytest.raises(click.ClickException) as error:
        configure_mcp(tmp_path, role="worker", supabase_url=url)
    assert "private-password" not in str(error.value)
    assert not (tmp_path / ".pi").exists()
