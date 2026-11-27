"""CoS-only refresh validates inputs and never creates Manager Telegram state."""

import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("filename,bot_id", [(".env", 101), (".env.prod", 201), ("custom.env", 301)], ids=["dev", "prod", "custom"])
def test_refresh_accepts_dev_prod_and_custom_environment_files(config_env, filename, bot_id):
    config_env.write_env("custom.env", 301)
    result = config_env.refresh(filename)
    assert result.returncode == 0, result.stderr
    profile = config_env.config("cos")["profiles"]["default"]
    assert profile["botId"] == bot_id
    assert profile["allowedUserId"] == 123
    assert not config_env.config_path("manager").exists()
    assert "secret" not in result.stdout + result.stderr


def test_unchanged_refresh_does_not_rewrite_configuration(config_env):
    assert config_env.refresh().returncode == 0
    before = config_env.config_path("cos").stat().st_mtime_ns
    assert config_env.refresh().returncode == 0
    assert config_env.config_path("cos").stat().st_mtime_ns == before


@pytest.mark.parametrize("old,new", [
    ("101:cos-secret", "invalid"),
    ("USER_ID=123", "USER_ID=0"),
    ("new_cos_bot", "invalid-name"),
], ids=["token", "owner-id", "username"])
def test_invalid_inputs_leave_configuration_untouched(config_env, old, new):
    path = config_env.root / ".env"
    path.write_text(path.read_text().replace(old, new))
    before = config_env.config_path("cos").read_bytes()
    result = config_env.refresh()
    assert result.returncode != 0
    assert config_env.config_path("cos").read_bytes() == before
    assert not config_env.config_path("manager").exists()


def test_refresh_requires_only_cos_telegram_values(config_env):
    (config_env.root / ".env").write_text("COS_TELEGRAM_TOKEN=601:private\nTELEGRAM_ALLOWED_USER_ID=123\n")
    result = config_env.refresh()
    assert result.returncode == 0, result.stderr
    assert config_env.config("cos")["profiles"]["default"]["botId"] == 601


@pytest.mark.parametrize("args,expected_id", [
    ([], 101),
    (["ENV_FILE=.env.prod"], 201),
    (["ENV_FILE=custom file.env"], 501),
], ids=["default-dev", "prod-file", "file-with-space"])
def test_make_defaults_to_dev_and_accepts_file_arguments(config_env, args, expected_id):
    config_env.write_env("custom file.env", 501)
    result = subprocess.run([shutil.which("make"), "refresh-telegram", *args], cwd=config_env.root, capture_output=True, text=True,
                            env=dict(os.environ, PATH=f"{config_env.bin}:{os.environ['PATH']}"))
    assert result.returncode == 0, result.stderr
    assert config_env.config("cos")["profiles"]["default"]["botId"] == expected_id
