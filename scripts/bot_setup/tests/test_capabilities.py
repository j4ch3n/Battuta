"""Configuration, not a model, determines the worker's immutable capability set."""

import json
import re

import click
import pytest

from bot_setup import instances
from bot_setup.manifest import load_manifest
from skill_fixtures import manifest_text


def profile(tmp_path, extra="", catalog=None):
    path = tmp_path / "bots/worker"
    path.mkdir(parents=True)
    base = re.sub(r"\[worker(?:\.[^\]]+)?\]\n.*?(?=\n\[|\Z)", "", manifest_text("worker", []), flags=re.S)
    (path / "bot.toml").write_text(base + "\n" + extra)
    (path / "abilities.json").write_text(json.dumps(catalog or {}))
    return tmp_path


def test_capabilities_select_type_and_union_without_source_checkout(tmp_path):
    root = profile(tmp_path, """
[worker]
capabilities = ["test_one"]
[worker.types.general]
capabilities = []
[worker.types.specialist]
capabilities = ["test_two", "test_one"]
""", {"test_one": {}, "test_two": {}})
    values = {"BATTUTA_WORKER_1_TYPE": "general", "BATTUTA_WORKER_2_TYPE": "specialist"}
    assert json.loads(instances.worker_environment(root, values, tmp_path / ".env", "worker-1")["BATTUTA_WORKER_CAPABILITIES"]) == ["test_one"]
    assert json.loads(instances.worker_environment(root, values, tmp_path / ".env", "worker-2")["BATTUTA_WORKER_CAPABILITIES"]) == ["test_one", "test_two"]


@pytest.mark.parametrize("extra,kind", [
    ('[worker]\ncapabilities=[]\n[worker.types.general]\ncapabilities=[]', "missing"),
    ('[worker]\ncapabilities=["mobile_browse"]\n[worker.types.general]\ncapabilities=[]', "general"),
    ('[worker]\ncapabilities=[]\n[worker.types.general]\ncapabilities=["mobile_browse"]', "general"),
])
def test_bad_type_or_unknown_capability_refuses(tmp_path, extra, kind):
    root = profile(tmp_path, extra)
    with pytest.raises(click.ClickException):
        instances.worker_environment(root, {"BATTUTA_WORKER_1_TYPE": kind}, tmp_path / ".env", "worker-1")


@pytest.mark.parametrize("capabilities", ['"text"', "[1]", "false"])
def test_manifest_rejects_malformed_capabilities(tmp_path, capabilities):
    root = profile(tmp_path, f"\n[worker]\ncapabilities={capabilities}\n[worker.types.general]\ncapabilities=[]")
    with pytest.raises(click.ClickException):
        load_manifest(root / "bots/worker/bot.toml")


def test_unconfigured_instance_refuses(tmp_path):
    root = profile(tmp_path, "\n[worker]\ncapabilities=[]\n[worker.types.general]\ncapabilities=[]")
    with pytest.raises(click.ClickException):
        instances.worker_environment(root, {}, tmp_path / ".env", "worker-1")
