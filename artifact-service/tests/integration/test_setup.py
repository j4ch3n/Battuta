"""Installed CLI setup is repeatable and preserves current-format registrations."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from battuta_artifacts.registry import Registry

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[3]


def test_installed_cli_setup_preserves_current_registrations(tmp_path):
    database = tmp_path.resolve() / 'registry.db'
    env = {**os.environ, 'BATTUTA_ARTIFACT_DB': str(database)}
    args = [sys.executable, '-c', 'from battuta_artifacts.cli import main; main()', 'setup']
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    store = Registry(database)
    store.check_schema()
    store.register(slug='draft', title='Draft', description='Hidden', source_root='/source',
                   entry_path='index.html', format='html', files={'index.html': 'text/html'})
    before = store.get('draft')
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert store.get('draft') == before


def test_release_setup_uses_installed_tool_and_propagates_failure(tmp_path):
    root = tmp_path
    (root / 'scripts').mkdir()
    shutil.copy2(ROOT / 'scripts/setup-artifacts.sh', root / 'scripts/setup-artifacts.sh')
    binary = root / 'bin'
    binary.mkdir()
    for executable in (binary / 'uv', binary / 'battuta-artifact'):
        executable.write_text(f'#!{sys.executable}\nimport json, os, sys\nwith open(os.environ["CALLS"], "a") as log: log.write(json.dumps(sys.argv) + "\\n")\nif sys.argv[1:] == ["setup"]: sys.exit(7)\n')
        executable.chmod(0o755)
    log = root / 'calls'
    result = subprocess.run(['bash', str(root / 'scripts/setup-artifacts.sh')], env={**os.environ,
        'PATH': f'{binary}:{os.environ["PATH"]}', 'CALLS': str(log)}, capture_output=True, text=True)
    assert result.returncode == 7
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert [call[1:] for call in calls] == [['setup']]
    assert not (root / 'artifact-service').exists()
