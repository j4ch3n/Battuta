"""Shared MCP setup preserves custom/private state and validates before writes."""

import json

import click
import pytest

from bot_setup.mcp import configure_mcp


@pytest.mark.parametrize("role", ["cos", "manager", "worker"])
def test_native_configuration_preserves_custom_and_private_state(tmp_path, role):
    pi = tmp_path / ".pi"
    pi.mkdir()
    (pi / "mcp.json").write_text('{"custom":true,"mcpServers":{"other":{"command":"custom"},"memory":{"url":"http://localhost:8901/mcp","exposure":"codemode"}}}')
    (pi / "settings.json").write_text('{"theme":"dark","packages":["npm:custom@1"]}')
    auth = pi / "mcp-auth.json"
    auth.write_bytes(b'{"private":"oauth"}\n')
    for _ in range(2):
        configure_mcp(tmp_path, role=role, memory_url="http://localhost:8989/mcp", supabase_url="http://localhost:54321")
        config = json.loads((pi / "mcp.json").read_text())
        assert config["custom"] is True
        assert config["mcpServers"]["other"] == {"command": "custom"}
        assert ("luma" in config["mcpServers"]) == (role == "cos")
        expected_memory = (
            {
                "url": "http://localhost:8989/mcp/read",
                "enabled": True,
                "exposure": "codemode",
                "description": "Read-only project memory: recall and project overviews",
            }
            if role == "manager"
            else {
                "url": "http://localhost:8989/mcp",
                "enabled": True,
                "exposure": "hidden",
                "toolExposure": {name: "codemode" for name in ("memory_forget", "memory_project_overview", "memory_project_descriptions")},
                "description": "Owner-confirmed memory forget plus project memory reads",
            }
            if role == "cos"
            else {"enabled": False}
        )
        assert config["mcpServers"]["memory"] == expected_memory
        if role == "cos":
            assert "memory_forget" in config["mcpServers"]["memory"]["toolExposure"]
            assert "memory_recall" not in config["mcpServers"]["memory"]["toolExposure"]
            assert not config["mcpServers"]["memory"]["url"].endswith("/read")
        elif role == "manager":
            assert "toolExposure" not in config["mcpServers"]["memory"]
        assert json.loads((pi / "settings.json").read_text()) == {"theme": "dark", "packages": ["npm:custom@1"]}
        assert auth.read_bytes() == b'{"private":"oauth"}\n'
        assert (pi / "mcp.json").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("role", ["cos", "manager"])
@pytest.mark.parametrize("url", ["https://localhost/mcp", "http://example.com/mcp", "http://user:private-password@localhost/mcp", "invalid", ""], ids=["https", "remote-host", "credentials", "not-a-url", "empty"])
def test_invalid_endpoint_has_no_writes_or_secret_in_error(tmp_path, role, url):
    with pytest.raises(click.ClickException, match="loopback HTTP") as error:
        configure_mcp(tmp_path, role=role, memory_url=url, supabase_url="http://localhost:54321")
    assert "private-password" not in str(error.value)
    assert not (tmp_path / ".pi").exists()


@pytest.mark.parametrize("name,value", [("mcp.json", "null"), ("mcp.json", "[]"), ("mcp.json", '{"mcpServers":null}'), ("mcp.json", '{"mcpServers":[]}'), ("mcp.json", '{"private":"secret-value",broken}'), ("settings.json", "null"), ("settings.json", '{"packages":{}}'), ("settings.json", '{"packages":null}')],
                         ids=["mcp-null", "mcp-array", "mcp-servers-null", "mcp-servers-array", "mcp-broken-secret", "settings-null", "settings-packages-object", "settings-packages-null"])
def test_invalid_json_config_does_not_modify_either_file(tmp_path, name, value):
    pi = tmp_path / ".pi"
    pi.mkdir()
    before = {"mcp.json": "{}", "settings.json": "{}", name: value}
    for file, text in before.items():
        (pi / file).write_text(text)
    with pytest.raises(click.ClickException) as error:
        configure_mcp(tmp_path, role="cos", supabase_url="http://localhost:54321")
    assert "secret-value" not in str(error.value)
    assert {file: (pi / file).read_text() for file in before} == before


@pytest.mark.parametrize("url", [None, "http://127.0.0.1:8901/mcp", "http://localhost:8901/mcp", "http://[::1]:8901/mcp"], ids=["default", "loopback-ip", "localhost", "ipv6-loopback"])
def test_loopback_endpoints_are_supported(tmp_path, url):
    configure_mcp(tmp_path, role="cos", memory_url=url, supabase_url="http://localhost:54321")
    assert (tmp_path / ".pi/mcp.json").is_file()


def test_unknown_role_is_rejected(tmp_path):
    with pytest.raises(click.ClickException, match="role"):
        configure_mcp(tmp_path, role="unknown", supabase_url="http://localhost:54321")
    assert not (tmp_path / ".pi").exists()


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e400"])
def test_nonfinite_json_rejected_before_any_configuration_write(tmp_path, number):
    pi = tmp_path / ".pi"
    pi.mkdir()
    original = '{"custom":' + number + '}'
    settings = '{"packages":["npm:custom@1"]}'
    (pi / "mcp.json").write_text(original)
    (pi / "settings.json").write_text(settings)
    with pytest.raises(click.ClickException, match="Invalid JSON"):
        configure_mcp(tmp_path, role="cos", supabase_url="http://localhost:54321")
    assert (pi / "mcp.json").read_text() == original
    assert (pi / "settings.json").read_text() == settings


@pytest.mark.parametrize("number", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_output_is_rejected_before_creating_files(tmp_path, number):
    from bot_setup.json_config import write_config
    with pytest.raises(click.ClickException):
        write_config(tmp_path / "new/settings.json", {"private": "secret-value", "number": number}, ".settings-")
    assert not (tmp_path / "new").exists()
