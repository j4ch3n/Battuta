"""Artifact links follow the real project registry's checkout validation."""

import json

import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from battuta_artifacts.app import create_app
from battuta_artifacts.cli import main
from battuta_artifacts.registry import migrate

pytestmark = pytest.mark.integration


def test_project_without_valid_checkout_rejects_links(tmp_path, monkeypatch):
    home = tmp_path.resolve()
    database = home / "registry.db"
    for name, value in {"HOME": str(home), "BATTUTA_ARTIFACT_DB": str(database),
                        "BATTUTA_ARTIFACT_BASE_URL": "https://example.test/artifacts", "LINEAR_API_TOKEN": ""}.items():
        monkeypatch.setenv(name, value)
    project = home / ".battuta/projects/procurement"
    code = project / "code"
    code.mkdir(parents=True)
    (project / "project.yaml").write_text(
        json.dumps({"version": 1, "linear": {"project_id": None, "team_id": None}, "github": {"repository": None}}))
    (code / "notes.txt").write_bytes(b"tracked")
    migrate(database)

    def run(*args):
        return CliRunner().invoke(main, [*args, "--json"])

    def get():
        with TestClient(create_app(database)) as client:
            return client.get("/artifacts/a/sizing/linked.txt")

    def publish():
        return run("publish", "--project", "procurement", "--artifact", "sizing", "--file", "linked.txt")

    assert run("init", "sizing", "--project", "procurement", "--title", "Sizing", "--description", "Evidence",
               "--vendor", "mermaid").exit_code == 0
    (project / "artifacts/sizing/linked.txt").symlink_to(code / "notes.txt")
    result = publish()
    assert result.exit_code == 0, result.output
    assert get().content == b"tracked"

    real = project / "code-real"
    code.rename(real)
    code.symlink_to(real, target_is_directory=True)
    assert get().status_code == 404
    assert publish().exit_code != 0
    code.unlink()
    assert get().status_code == 404
