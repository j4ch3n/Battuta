"""Component servers start from the installed command with a scrubbed private environment."""

import json
import os
import subprocess
import sys

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("component,command", [("memory", "battuta-memory"), ("artifacts", "battuta-artifact")], ids=["memory", "artifacts"])
def test_component_environment_is_loaded_and_scrubbed(tmp_path, component, command):
    tool = tmp_path / command
    tool.write_text(f"#!{sys.executable}\nimport json,os,sys\nprint(json.dumps({{'args':sys.argv[1:],'data':os.environ.get('BATTUTA_MEMORY_DATA_DIR'),'telegram':any('TELEGRAM' in key for key in os.environ)}}))\n")
    tool.chmod(0o700)
    env_file = tmp_path / ".env.prod"
    env_file.write_text('BATTUTA_MEMORY_DATA_DIR="/private/memory"\nCOS_TELEGRAM_TOKEN=sentinel\n')
    result = subprocess.run([sys.executable, "-m", "battuta_packaging.cli", "run-component", "--component", component, "--env-file", str(env_file)], env={**os.environ, "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"]}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"args": ["serve"], "data": "/private/memory", "telegram": False}
