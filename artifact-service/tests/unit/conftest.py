"""Unit fixtures stay inside battuta_artifacts: the sibling project registry is a contract-faithful fake."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import click
import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from battuta_artifacts.app import create_app
from battuta_artifacts.cli import main
from battuta_artifacts.registry import Registry, migrate


@pytest.fixture
def http(tmp_path):
    """A migrated registry with one published HTML bundle and an unregistered secret beside it."""
    root = tmp_path.resolve()
    db = root / "registry.sqlite3"
    source = root / "source"
    (source / "js").mkdir(parents=True)
    (source / "index.html").write_text('<script src="js/app.js"></script>')
    (source / "js/app.js").write_text("console.log('live')")
    (source / "secret.txt").write_text("private")
    migrate(db)
    registry = Registry(db)
    registry.register(slug="demo", title="Demo", description="Description", source_root=str(source), status="published",
                      entry_path="index.html", format="html",
                      files={"index.html": "text/html", "js/app.js": "text/javascript"})
    clients = []

    def client():
        clients.append(TestClient(create_app(db)))
        return clients[-1]

    yield SimpleNamespace(root=root, db=db, source=source, registry=registry, client=client)
    for opened in clients:
        opened.close()


class Bundle:
    """CLI access to the `sizing` artifact of the `procurement` project under a temporary HOME."""

    def __init__(self, home, registry):
        self.home = home
        self.registry = registry
        self.project = home / ".battuta/projects/procurement"
        self.code = self.project / "code"
        self.directory = self.project / "artifacts/sizing"
        self.store = Registry(home / "registry.db")

    def command(self, *args, env=None):
        return CliRunner(env=env).invoke(main, [*args, "--json"])

    def init(self, *args):
        return self.command("init", "sizing", "--project", "procurement", "--title", 'VRAM <sizing> "guide"',
                            "--description", "Evidence & assumptions", *args)

    def publish(self, *args):
        return self.command("publish", "--project", "procurement", "--artifact", "sizing", *args,
                            env={"BATTUTA_ARTIFACT_BASE_URL": "https://example.test/artifacts"})

    def get(self, path=""):
        with TestClient(create_app(self.store.path)) as client:
            return client.get("/artifacts/a/sizing/" + path)


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    """`procurement` resolves through a fake ProjectRegistry, exposed as `bundle.registry`."""
    home = tmp_path.resolve()
    for name, value in {"HOME": str(home), "BATTUTA_ARTIFACT_DB": str(home / "registry.db"),
                        "BATTUTA_ARTIFACT_BASE_URL": "", "LINEAR_API_TOKEN": ""}.items():
        monkeypatch.setenv(name, value)
    projects = {"procurement": SimpleNamespace(name="procurement", root=home / ".battuta/projects/procurement",
                                               code=home / ".battuta/projects/procurement/code")}

    def load(name):
        if name not in projects:
            raise click.ClickException(f"Project not found: {name}")
        return projects[name]

    registry = MagicMock(name="ProjectRegistry")
    registry.return_value.load.side_effect = load
    # bundles binds the name at import; files and cli look it up on battuta_project.registry at call time.
    monkeypatch.setattr("battuta_artifacts.bundles.ProjectRegistry", registry)
    monkeypatch.setattr("battuta_project.registry.ProjectRegistry", registry)
    created = Bundle(home, registry)
    created.code.mkdir(parents=True)
    migrate(created.store.path)
    return created
