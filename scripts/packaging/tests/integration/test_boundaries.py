"""Unit tests exercise packaging alone; bot_setup runs only in integration tests."""

import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

PACKAGE = Path(__file__).resolve().parents[2]

# Stub every bot_setup module packaging imports before anything imports them. A stub name
# records any call or attribute use, because callers may swallow its exception, and fails the session.
BOOTSTRAP = """
import sys, types
import pytest

uses = []

class Recorder:
    def __init__(self, name):
        self._name = name

    def _use(self, how):
        uses.append(self._name + how)
        raise AssertionError(f"unit test used bot_setup {self._name}{how}")

    def __call__(self, *args, **kwargs):
        self._use("()")

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        self._use("." + name)

    def __fspath__(self):
        self._use(" as a path")

    __str__ = __iter__ = __fspath__

def stub_missing(attribute):
    raise AttributeError(attribute)

package = types.ModuleType("bot_setup")
package.__path__ = []
sys.modules["bot_setup"] = package
for name in ("browser", "claude_skills", "env", "extensions", "files", "instances", "json_config",
             "manifest", "mcp", "release", "runtime", "skills"):
    module = types.ModuleType(f"bot_setup.{name}")
    module.__getattr__ = lambda attribute, module=name: (
        Recorder(f"{module}.{attribute}") if not attribute.startswith("__") else stub_missing(attribute))
    setattr(package, name, module)
    sys.modules[module.__name__] = module

class Plugin:
    @staticmethod
    def pytest_sessionfinish(session):
        if uses:
            print(f"bot_setup used by unit tests: {uses}")
            session.exitstatus = 1

sys.exit(pytest.main([sys.argv[1], "-q", "-p", "no:cacheprovider"], plugins=[Plugin()]))
"""


def test_unit_suite_never_runs_bot_setup():
    result = subprocess.run([sys.executable, "-c", BOOTSTRAP, str(PACKAGE / "tests/unit")], cwd=PACKAGE,
                            capture_output=True, text=True)

    assert result.returncode == 0, result.stdout + result.stderr
