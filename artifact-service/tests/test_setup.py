"""Installed CLI setup is repeatable and preserves current-format registrations."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from battuta_artifacts.registry import Registry

ROOT = Path(__file__).resolve().parents[2]


class SetupTests(unittest.TestCase):
    def test_installed_cli_setup_preserves_current_registrations(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as directory:
            root = Path(directory).resolve()
            database = root / 'registry.db'
            env = {**os.environ, 'BATTUTA_ARTIFACT_DB': str(database)}
            args = [sys.executable, '-c', 'from battuta_artifacts.cli import main; main()', 'setup']
            result = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            store = Registry(database)
            store.check_schema()
            store.register(slug='draft', title='Draft', description='Hidden', source_root='/source',
                            entry_path='index.html', format='html', files={'index.html': 'text/html'})
            before = store.get('draft')
            result = subprocess.run(args, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(store.get('draft'), before)

    def test_release_setup_uses_installed_tool_and_propagates_failure(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
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
            self.assertEqual(result.returncode, 7)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual([call[1:] for call in calls], [['setup']])
            self.assertFalse((root / 'artifact-service').exists())
