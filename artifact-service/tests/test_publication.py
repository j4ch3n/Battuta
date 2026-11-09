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
        self.assertEqual(self.init('--vendor', 'mermaid').exit_code, 0)
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
            for path in ('secret.txt', 'file-meta.json', 'vendor/importmap.json', 'NOTICE.txt'):
                self.assertEqual(client.get('/artifacts/a/sizing/' + path).status_code, 404)
            self.assertEqual(len(client.get('/artifacts/catalog').json()['artifacts']), 1)
            self.assertEqual(self.command('deregister', 'sizing').exit_code, 0)
            self.assertEqual(client.get('/artifacts/a/sizing/').status_code, 404)
            self.assertTrue((directory / 'index.html').exists())

    def test_failed_publish_and_complete_file_replacement_preserve_draft(self):
        self.init('--vendor', 'mermaid')
        directory = self.project / 'artifacts/sizing'
        (directory / 'styles.css').unlink()
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
        self.init('--vendor', 'mermaid')
        result = self.command('publish', '--project', 'procurement', '--artifact', 'sizing')
        self.assertEqual(result.exit_code, 2)
        self.assertEqual(self.store.get('sizing')['status'], 'draft')
