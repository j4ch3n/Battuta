"""Release wrapper + setup script + real CLI against a disposable old registry."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from alembic import command
from sqlalchemy import URL, create_engine

from battuta_artifacts.registry import Registry, migrate, migration_config

ROOT = Path(__file__).resolve().parents[2]


class SetupTests(unittest.TestCase):
    def test_release_setup_upgrades_old_database_and_preserves_existing_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'bin').mkdir()
            (root / 'scripts').mkdir()
            shutil.copy2(ROOT / 'packaging/battuta', root / 'bin/battuta')
            shutil.copy2(ROOT / 'scripts/setup-artifacts.sh', root / 'scripts/setup-artifacts.sh')
            venv = root / 'artifact-service/.venv/bin'
            venv.mkdir(parents=True)
            (root / 'bin/uv').write_text('#!/bin/sh\nexit 0\n')
            (root / 'bin/uv').chmod(0o755)
            (venv / 'battuta-artifact').write_text(f'#!{sys.executable}\nfrom battuta_artifacts.cli import main\nmain()\n')
            (venv / 'battuta-artifact').chmod(0o755)
            database = root / 'registry.db'
            engine = create_engine(URL.create('sqlite', database=str(database)))
            with engine.begin() as connection:
                config = migration_config()
                config.attributes['connection'] = connection
                command.upgrade(config, '0001_registry')
                connection.exec_driver_sql("INSERT INTO artifacts VALUES ('old', 'old', 'Old', 'Existing', '/source', 'index.html', 'html', 1, 'then', 'then')")
                connection.exec_driver_sql("INSERT INTO artifact_files VALUES ('old', 'index.html', 'text/html')")
            engine.dispose()
            env = {**os.environ, 'BATTUTA_ARTIFACT_DB': str(database), 'PATH': f"{root / 'bin'}:{os.environ['PATH']}"}
            result = subprocess.run(['bash', str(root / 'bin/battuta'), 'setup-artifacts'], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            store = Registry(database)
            store.check_schema()
            self.assertEqual(store.get('old')['status'], 'published')
            store.register(slug='draft', title='Draft', description='Hidden', source_root='/source',
                           entry_path='index.html', format='html', files={'index.html': 'text/html'})
            result = subprocess.run(['bash', str(root / 'bin/battuta'), 'setup-artifacts'], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(store.get('draft')['status'], 'draft')

    def test_release_setup_reinstalls_local_wheels_before_migration_and_propagates_failure(self):
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            shutil.copy2(ROOT / 'scripts/setup-artifacts.sh', root / 'scripts/setup-artifacts.sh')
            wheels = root / 'artifact-service/wheels'
            wheels.mkdir(parents=True)
            (wheels.parent / 'requirements.txt').write_text('')
            names = ['battuta_artifacts-0.1.0-py3-none-any.whl', 'battuta_project-0.1.0-py3-none-any.whl']
            for name in names:
                (wheels / name).write_bytes(name.encode())
            (wheels / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(name.encode()).hexdigest()}  {name}\n' for name in names))
            binary = root / 'bin'
            binary.mkdir()
            venv = root / 'artifact-service/.venv/bin'
            venv.mkdir(parents=True)
            (venv / 'python').symlink_to(sys.executable)
            for executable in (binary / 'uv', venv / 'battuta-artifact'):
                executable.write_text(f'#!{sys.executable}\nimport json, os, sys\nwith open(os.environ["CALLS"], "a") as log: log.write(json.dumps(sys.argv) + "\\n")\nif sys.argv[1:] == ["setup"]: sys.exit(7)\n')
                executable.chmod(0o755)
            log = root / 'calls'
            result = subprocess.run(['bash', str(root / 'scripts/setup-artifacts.sh')], env={**os.environ,
                'PATH': f'{binary}:{os.environ["PATH"]}', 'CALLS': str(log)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 7)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            installations = [call for call in calls if '--no-deps' in call]
            self.assertEqual(len(installations), 1)
            self.assertIn('--reinstall', installations[0])
            self.assertTrue(all(any(arg.endswith(name) for arg in installations[0]) for name in names))
            self.assertEqual(calls[-1][1:], ['setup'])
