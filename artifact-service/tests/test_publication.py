import json
import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from test_bundles import BundleFixture


class PublicationTests(BundleFixture):
    def command(self, *args):
        from battuta_artifacts.cli import main
        from click.testing import CliRunner
        return CliRunner().invoke(main, [*args, '--json'])

    def publish(self, *args):
        with patch.dict(os.environ, {'BATTUTA_ARTIFACT_BASE_URL': 'https://example.test/artifacts'}):
            return self.command('publish', '--project', 'procurement', '--artifact', 'sizing', *args)

    def test_draft_is_inaccessible_until_explicit_publication(self):
        from battuta_artifacts.app import create_app
        self.assertEqual(self.init().exit_code, 0)
        item = self.store.get('sizing')
        with TestClient(create_app(self.store.path)) as client:
            self.assertEqual(client.get('/artifacts/catalog').json(), {'artifacts': []})
            self.assertNotIn('VRAM', client.get('/artifacts/').text)
            with patch('battuta_artifacts.app.open_source', side_effect=AssertionError('Draft files must not open')):
                for path in ['', *item['files']]:
                    self.assertEqual(client.get('/artifacts/a/sizing/' + path).json(),
                                     client.get('/artifacts/a/unknown/').json())
            self.assertEqual(json.loads(self.command('show', 'sizing').output)['artifact']['status'], 'draft')
            self.assertEqual(json.loads(self.command('list').output)['artifacts'][0]['status'], 'draft')
            directory = self.project / 'artifacts/sizing'
            (directory / 'index.html').write_text('<h1>Authored report</h1><script src="extra.js"></script>')
            (directory / 'extra.js').write_text('window.example = true;')
            (directory / 'secret.txt').write_text('private')
            result = self.publish('--file', 'extra.js', '--expected-revision', '1')
            self.assertEqual(result.exit_code, 0, result.output)
            published = json.loads(result.output)['artifact']
            self.assertEqual((published['id'], published['revision'], published['status']), (item['id'], 2, 'published'))
            self.assertEqual(self.publish().exit_code, 0)
            self.assertEqual(self.store.get('sizing')['revision'], 2)
            self.assertEqual(self.publish('--expected-revision', '1').exit_code, 4)
            self.assertIn('Authored report', client.get('/artifacts/a/sizing/').text)
            for path in published['files']:
                self.assertEqual(client.get('/artifacts/a/sizing/' + path).status_code, 200, path)
            for path in ('secret.txt', 'file-meta.json', 'USAGE.md'):
                self.assertEqual(client.get('/artifacts/a/sizing/' + path).status_code, 404)
            self.assertEqual(len(client.get('/artifacts/catalog').json()['artifacts']), 1)
            self.assertEqual(self.command('deregister', 'sizing').exit_code, 0)
            self.assertEqual(client.get('/artifacts/a/sizing/').status_code, 404)
            self.assertTrue((directory / 'index.html').exists())

    def test_failed_publish_and_complete_file_replacement_preserve_draft(self):
        self.init()
        directory = self.project / 'artifacts/sizing'
        (directory / 'scene.js').unlink()
        self.assertEqual(self.publish().exit_code, 2)
        self.assertEqual(self.store.get('sizing')['status'], 'draft')
        (directory / 'custom.css').write_text('body {color: blue}')
        result = self.command('replace-files', 'sizing', '--root', str(directory), '--entry', 'index.html', '--file', 'custom.css')
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(self.store.get('sizing')['status'], 'draft')
        self.assertEqual(set(self.store.get('sizing')['files']), {'index.html', 'custom.css'})
        self.assertEqual(self.publish('--file', '../secret').exit_code, 2)
        self.assertEqual(self.store.get('sizing')['status'], 'draft')
        self.assertEqual(self.publish().exit_code, 0)

    def test_missing_public_url_does_not_publish_as_failed_command(self):
        self.init()
        result = self.command('publish', '--project', 'procurement', '--artifact', 'sizing')
        self.assertEqual(result.exit_code, 2)
        self.assertEqual(self.store.get('sizing')['status'], 'draft')

    def test_add_markdown_publishes_existing_file_and_rejects_invalid_sources(self):
        from battuta_artifacts.app import create_app
        source = self.home / 'existing.md'
        source.write_text('# Research\n\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))')
        before = source.read_bytes()
        def add(path, *args):
            with patch.dict(os.environ, {'BATTUTA_ARTIFACT_BASE_URL': 'https://example.test/artifacts'}):
                return self.command('add-file', '--type', 'markdown', '--file', str(path), '--slug', 'notes',
                                    '--title', 'Notes', '--description', 'Existing research', *args)
        invalid = self.home / 'invalid.md'
        invalid.write_bytes(b'\xff')
        linked = self.home / 'linked.md'
        linked.symlink_to(source)
        for path in ('relative.md', self.home, self.home / 'missing.md', invalid, linked):
            with self.subTest(path=path):
                self.assertNotEqual(add(path).exit_code, 0)
                self.assertEqual(self.store.list(), [])
        result = add(source)
        self.assertEqual(result.exit_code, 0, result.output)
        item = json.loads(result.output)['artifact']
        self.assertEqual(item['status'], 'published')
        self.assertEqual(item['source_root'], str(self.home))
        self.assertEqual(item['files'], {'existing.md': 'text/markdown'})
        self.assertEqual(source.read_bytes(), before)
        self.assertFalse((self.project / 'artifacts').exists())
        self.assertEqual(add(source).exit_code, 4)
        with TestClient(create_app(self.store.path)) as client:
            response = client.get('/artifacts/a/notes/')
            self.assertEqual(response.status_code, 200)
            self.assertIn('<h1>Research</h1>', response.text)
            self.assertNotIn('<script>alert(1)</script>', response.text)
            self.assertNotIn('href="javascript:', response.text)
            self.assertEqual(client.get('/artifacts/a/notes/invalid.md').status_code, 404)
