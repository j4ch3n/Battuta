"""Run fixture Git commands isolated from any repository an outer Git process selected."""

import os
import shutil
import subprocess

import pytest

requires_git = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


def git_env(**overrides):
    """Return the inherited environment without GIT_* variables, such as those hooks export."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    return {**env, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, **overrides}


def run_git(*args, cwd, **kwargs):
    """Run git in an explicit fixture directory with a hermetic environment."""
    return subprocess.run(["git", *args], cwd=cwd, env=git_env(), **kwargs)
