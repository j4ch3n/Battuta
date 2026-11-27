"""Release-install checks keep each wheel's tool environment separate."""

from release_install_env import tool_environment


def test_tool_environment_is_unique_per_release_wheel(tmp_path):
    base = {"HOME": str(tmp_path / "home")}
    project = tool_environment(base, tmp_path, "battuta-project")
    packaging = tool_environment(base, tmp_path, "battuta-packaging")

    assert base == {"HOME": str(tmp_path / "home")}
    assert project["UV_TOOL_DIR"] != packaging["UV_TOOL_DIR"]
    assert project["UV_TOOL_BIN_DIR"] != packaging["UV_TOOL_BIN_DIR"]
    assert project["UV_TOOL_DIR"] == str(tmp_path / "tools" / "battuta-project")
    assert project["UV_TOOL_BIN_DIR"] == str(tmp_path / "bin" / "battuta-project")
