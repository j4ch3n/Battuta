"""Shared MCP setup preserves custom/private state and validates before writes."""

import json

import click
import pytest

from bot_setup.mcp import configure_mcp


@pytest.mark.parametrize("role", ["cos", "manager"])
def test_native_configuration_preserves_custom_and_private_state(tmp_path, role):
    pi = tmp_path / ".pi"
    pi.mkdir()
    (pi / "mcp.json").write_text('{"custom":true,"mcpServers":{"other":{"command":"custom"}}}')
    (pi / "settings.json").write_text('{"theme":"dark","packages":["npm:custom@1","npm:pi-mcp-adapter@1"]}')
    auth = pi / "mcp-auth.json"
    auth.write_bytes(b'{"private":"oauth"}\n')
    for _ in range(2):
        configure_mcp(tmp_path, role=role, memory_url="http://localhost:8989/mcp", supabase_url="http://localhost:54321")
        config = json.loads((pi / "mcp.json").read_text())
        assert config["custom"] is True
        assert config["mcpServers"]["other"] == {"command": "custom"}
        assert ("luma" in config["mcpServers"]) == (role == "cos")
        assert json.loads((pi / "settings.json").read_text()) == {"theme": "dark", "packages": ["npm:custom@1"]}
        assert auth.read_bytes() == b'{"private":"oauth"}\n'
        assert (pi / "mcp.json").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("url", ["https://localhost/mcp", "http://example.com/mcp", "http://user:private-password@localhost/mcp", "invalid", ""])
def test_invalid_endpoint_has_no_writes_or_secret_in_error(tmp_path, url):
    with pytest.raises(click.ClickException, match="loopback HTTP") as error:
        configure_mcp(tmp_path, role="cos", memory_url=url, supabase_url="http://localhost:54321")
    assert "private-password" not in str(error.value)
    assert not (tmp_path / ".pi").exists()


@pytest.mark.parametrize("name,value", [("mcp.json", "null"), ("mcp.json", "[]"), ("mcp.json", '{"mcpServers":null}'), ("mcp.json", '{"mcpServers":[]}'), ("mcp.json", '{"private":"secret-value",broken}'), ("settings.json", "null"), ("settings.json", '{"packages":{}}'), ("settings.json", '{"packages":null}')])
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


@pytest.mark.parametrize("url", [None, "http://127.0.0.1:8901/mcp", "http://localhost:8901/mcp", "http://[::1]:8901/mcp"])
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
    settings = '{"packages":["npm:pi-mcp-adapter@1"]}'
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
