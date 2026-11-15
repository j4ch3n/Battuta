"""Assignment MCP endpoint validation and shared profile configuration."""

import json
from urllib.parse import unquote

import click
import pytest

from bot_setup.mcp import configure_mcp
from bot_setup import mcp


@pytest.mark.parametrize("name", ["normal", "测试 home%2F#"])
def test_assignment_root_header_encodes_caller_home_without_creating_storage(tmp_path, name):
    home = tmp_path / name
    header = mcp.assignment_environment(home)["BATTUTA_PROJECTS_ROOT_HEADER"]
    assert header.isascii()
    assert unquote(header) == str(home / ".battuta/projects")
    assert not home.exists()


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
    assert server["headers"] == {
        "apikey": "${SUPABASE_SECRET_KEY}",
        "X-Battuta-Projects-Root": "${BATTUTA_PROJECTS_ROOT_HEADER}",
    }
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
