"""Release-install checks keep each wheel's tool environment separate."""

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).with_name("release_install.it.py")


def test_tool_environment_is_unique_per_release_wheel(tmp_path):
    spec = importlib.util.spec_from_file_location("release_install", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)

    tool_environment = getattr(module, "tool_environment", None)
    assert tool_environment

    base = {"HOME": str(tmp_path / "home")}
    project = tool_environment(base, tmp_path, "battuta-project")
    packaging = tool_environment(base, tmp_path, "battuta-packaging")

    assert base == {"HOME": str(tmp_path / "home")}
    assert project["UV_TOOL_DIR"] != packaging["UV_TOOL_DIR"]
    assert project["UV_TOOL_BIN_DIR"] != packaging["UV_TOOL_BIN_DIR"]
    assert project["UV_TOOL_DIR"] == str(tmp_path / "tools" / "battuta-project")
    assert project["UV_TOOL_BIN_DIR"] == str(tmp_path / "bin" / "battuta-project")
