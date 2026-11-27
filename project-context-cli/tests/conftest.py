"""Shared fixtures: a temporary home, stubbed clone/memory/Linear seams, and a CLI runner."""

from contextlib import contextmanager
import json
from pathlib import Path
import subprocess
from unittest.mock import patch

from click.testing import CliRunner
import httpx
import pytest

from battuta_project.cli import main
from battuta_project.memory import MemoryUnavailable
from battuta_project.registry import ProjectRegistry


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    return tmp_path


@pytest.fixture
def root(home):
    return home / ".battuta" / "projects"


@pytest.fixture
def clone(home):
    """GitHub cloning stubbed at the process boundary; yields the patched ``subprocess.run``."""
    def clone_repo(args, **kwargs):
        Path(args[4]).mkdir()
        return subprocess.CompletedProcess(args, 0)

    with patch("battuta_project.registry.subprocess.run", side_effect=clone_repo) as run:
        yield run


@pytest.fixture
def memory_call():
    with patch("battuta_project.memory._call", side_effect=MemoryUnavailable("unreachable")) as call:
        yield call


@pytest.fixture
def registry(home, clone):
    return ProjectRegistry()


@pytest.fixture
def project(registry, memory_call):
    return registry.init("atlas-api", github="https://github.com/team/atlas-api")


@pytest.fixture
def project_file(project):
    def write(relative: str, text: str = "") -> Path:
        path = project.code / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path
    return write


@pytest.fixture
def runner(monkeypatch, home, clone, memory_call):
    monkeypatch.setenv("LINEAR_API_TOKEN", "test-token")
    return CliRunner()


@pytest.fixture
def invoke(runner):
    def run(*args):
        result = runner.invoke(main, args)
        assert result.exit_code == 0, result.output
        return result.output
    return run


@pytest.fixture
def linear_http():
    """Stub only HTTP I/O while retaining the real gql and HTTPX clients."""
    @contextmanager
    def serve(*responses):
        requests = []
        pending = iter(responses)
        real_client = httpx.Client

        def handle(request):
            requests.append(request)
            response = next(pending)
            if callable(response):
                response = response(request)
            if isinstance(response, Exception):
                raise response
            return response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)

        def client(**kwargs):
            return real_client(transport=httpx.MockTransport(handle), **kwargs)

        with patch("gql.transport.httpx.httpx.Client", side_effect=client):
            yield requests
    return serve


@pytest.fixture
def payload():
    return lambda request: json.loads(request.content)


@pytest.fixture
def created_project():
    return {"data": {"projectCreate": {
        "success": True,
        "project": {"id": "project-1", "name": "Atlas", "url": "https://linear.app/team/project/atlas"},
    }}}


@pytest.fixture
def linear_project():
    return {"data": {"project": {
        "id": "project-1", "name": "Atlas", "url": "https://linear.app/team/project/atlas",
    }}}
