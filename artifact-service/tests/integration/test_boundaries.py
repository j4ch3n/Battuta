"""Unit tests never reach the sibling project registry."""

import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

PACKAGE = Path(__file__).resolve().parents[2]

# Stub battuta_project before anything imports it; any real use is recorded, because
# allowed_link_root swallows exceptions, and fails the session.
BOOTSTRAP = """
import sys, types
import pytest

uses = []

class Guard(type):
    def __getattr__(cls, name):
        uses.append(name)
        raise AssertionError(f"unit test reached ProjectRegistry.{name}")

class ProjectRegistry(metaclass=Guard):
    def __init__(self, *args, **kwargs):
        uses.append("__init__")
        raise AssertionError("unit test instantiated ProjectRegistry")

registry = types.ModuleType("battuta_project.registry")
registry.ProjectRegistry = ProjectRegistry
package = types.ModuleType("battuta_project")
package.registry = registry
sys.modules.update({"battuta_project": package, "battuta_project.registry": registry})

class Plugin:
    @staticmethod
    def pytest_sessionfinish(session):
        if uses:
            print(f"ProjectRegistry used by unit tests: {uses}")
            session.exitstatus = 1

sys.exit(pytest.main([sys.argv[1], "-q", "-p", "no:cacheprovider"], plugins=[Plugin()]))
"""


def test_unit_suite_never_runs_project_registry():
    result = subprocess.run([sys.executable, "-c", BOOTSTRAP, str(PACKAGE / "tests/unit")], cwd=PACKAGE,
                            capture_output=True, text=True)

    assert result.returncode == 0, result.stdout + result.stderr
