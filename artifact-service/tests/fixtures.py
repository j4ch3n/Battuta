"""Shared artifact-service test fixtures."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner
from fastapi.testclient import TestClient

from battuta_artifacts.cli import main
from battuta_artifacts.registry import Registry, migrate


class HttpFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "registry.sqlite3"
        self.source = self.root / "source"
        (self.source / "js").mkdir(parents=True)
        (self.source / "index.html").write_text('<script src="js/app.js"></script>')
        (self.source / "js/app.js").write_text("console.log('live')")
        (self.source / "secret.txt").write_text("private")
        migrate(self.db)
        self.registry = Registry(self.db)
        self.registry.register(slug="demo", title="Demo", description="Description", source_root=str(self.source), status="published",
                               entry_path="index.html", format="html",
                               files={"index.html": "text/html", "js/app.js": "text/javascript"})

    def client(self):
        from battuta_artifacts.app import create_app
        client = TestClient(create_app(self.db))
        self.addCleanup(client.close)
        return client


class BundleFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.environment = patch.dict(
            os.environ,
            {
                "HOME": str(self.home),
                "BATTUTA_ARTIFACT_DB": str(self.home / "registry.db"),
                "BATTUTA_ARTIFACT_BASE_URL": "",
                "LINEAR_API_TOKEN": "",
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.project = self.home / ".battuta/projects/procurement"
        (self.project / "code").mkdir(parents=True)
        (self.project / "project.yaml").write_text(
            json.dumps({"version": 1, "linear": {"project_id": None, "team_id": None}, "github": {"repository": None}})
        )
        self.store = Registry(self.home / "registry.db")
        migrate(self.store.path)

    def init(self, *args):
        return CliRunner().invoke(
            main,
            [
                "init",
                "sizing",
                "--project",
                "procurement",
                "--title",
                'VRAM <sizing> "guide"',
                "--description",
                "Evidence & assumptions",
                *args,
                "--json",
            ],
        )
