from bot_setup.mcp import mcp_payload


def test_speech_available_to_cos_and_workers_not_manager():
    for role in ("cos", "worker"):
        servers = mcp_payload(role=role, supabase_url="https://example.com")["mcpServers"]
        assert servers["speech"]["url"] == "http://127.0.0.1:8902/mcp"
    servers = mcp_payload(role="manager", supabase_url="https://example.com")["mcpServers"]
    assert servers["speech"]["enabled"] is False
