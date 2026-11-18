"""Register the shared document service with Claude Code sessions on the host."""

import os
from pathlib import Path
import shutil
import subprocess

import click

SERVER = "battuta-doc"
# Above the service's 900 s blocking cap; Claude Code's per-server timeout also floors its idle timeout.
CONFIG = '{"type":"http","url":"http://127.0.0.1:8903/mcp","timeout":1020000}'


def register_doc_service(home: Path, *, deployment: str) -> bool:
    """Add the user-scope Claude MCP entry; an existing entry is kept. Returns whether it was added."""
    if deployment != "main":
        return False
    claude = shutil.which("claude")
    if not claude:
        raise click.ClickException("Install Claude Code (`claude` on PATH) before configuring the main bundle's document service")
    env = {**os.environ, "HOME": str(home)}
    if subprocess.run([claude, "mcp", "get", SERVER], env=env, capture_output=True).returncode == 0:
        return False
    result = subprocess.run([claude, "mcp", "add-json", "--scope", "user", SERVER, CONFIG], env=env, capture_output=True, text=True)
    if result.returncode != 0:
        raise click.ClickException(f"Could not register {SERVER} with Claude Code: {result.stderr.strip() or result.stdout.strip()}")
    return True
