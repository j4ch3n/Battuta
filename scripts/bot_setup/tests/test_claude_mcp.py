"""The document service is registered for Claude Code only in the main bundle, without touching custom entries."""

import json
import os
import stat

import click
import pytest

from bot_setup.claude_mcp import register_doc_service

STUB = """#!/bin/sh
state="$HOME/claude-mcp.json"
case "$2" in
  get) [ -f "$state" ] ;;
  add-json) printf '%s' "$5 $6" > "$state" ;;
esac
"""


@pytest.fixture
def claude(tmp_path, monkeypatch):
    binary = tmp_path / "bin"
    binary.mkdir()
    stub = binary / "claude"
    stub.write_text(STUB)
    stub.chmod(stat.S_IRWXU)
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("PATH", f"{binary}{os.pathsep}{os.environ['PATH']}")
    return home


def test_registers_for_main_only(claude):
    assert register_doc_service(claude, deployment="influencer") is False
    assert not (claude / "claude-mcp.json").exists()
    assert register_doc_service(claude, deployment="main") is True
    entry = (claude / "claude-mcp.json").read_text()
    assert "battuta-doc" in entry and json.loads(entry.split(" ", 1)[1])["timeout"] > 900_000


def test_registration_is_idempotent_and_keeps_custom_entry(claude):
    (claude / "claude-mcp.json").write_text("custom")
    assert register_doc_service(claude, deployment="main") is False
    assert (claude / "claude-mcp.json").read_text() == "custom"
    (claude / "claude-mcp.json").unlink()
    assert register_doc_service(claude, deployment="main") is True
    assert register_doc_service(claude, deployment="main") is False


def test_registration_does_not_write_pi_mcp_config(claude):
    pi = claude / ".pi/mcp.json"
    pi.parent.mkdir()
    pi.write_text("{}")
    register_doc_service(claude, deployment="main")
    assert pi.read_text() == "{}"


def test_missing_claude_binary_fails_fast_with_actionable_error(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(click.ClickException, match="Install Claude Code"):
        register_doc_service(tmp_path, deployment="main")
    assert register_doc_service(tmp_path, deployment="influencer") is False


def test_failed_registration_reports_the_cause(claude, tmp_path):
    (tmp_path / "bin/claude").write_text("#!/bin/sh\n[ \"$2\" = get ] && exit 1\necho boom >&2\nexit 1\n")
    with pytest.raises(click.ClickException, match="boom"):
        register_doc_service(claude, deployment="main")
