import pytest


@pytest.fixture(autouse=True)
def claude_config(tmp_path_factory, monkeypatch):
    """Setup tests must never write to the developer's real Claude Code directory."""
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path_factory.mktemp("claude-config")))
