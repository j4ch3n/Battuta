import pytest


@pytest.fixture(autouse=True)
def claude_config(tmp_path_factory, monkeypatch):
    """Setup tests must never write to the developer's real Claude Code directory."""
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path_factory.mktemp("claude-config")))


@pytest.fixture
def config_env(tmp_path_factory, monkeypatch):
    """Copy of the CoS/Manager checkout boundary under a spaced path, with HOME inside it."""
    from fixtures import ConfigEnv

    root = tmp_path_factory.mktemp("battuta scripts ")
    monkeypatch.setenv("HOME", str(root / "home"))
    return ConfigEnv(root)


@pytest.fixture
def launcher_env(tmp_path_factory, monkeypatch):
    """`config_env` plus stubbed tmux/make/supabase so the real launcher scripts can run."""
    from fixtures import LauncherEnv

    root = tmp_path_factory.mktemp("battuta scripts ")
    monkeypatch.setenv("HOME", str(root / "home"))
    return LauncherEnv(root)
