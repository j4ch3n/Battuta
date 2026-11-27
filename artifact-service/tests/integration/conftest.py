"""Real CLI processes and HTTP server with HOME and the registry database under tmp_path."""

import json
import os
import re
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

ARTIFACT = [sys.executable, "-c", "from battuta_artifacts.cli import main; main()"]


@pytest.fixture
def env(tmp_path):
    home = tmp_path.resolve()
    return {**os.environ, "HOME": str(home), "LINEAR_API_TOKEN": "test",
            "BATTUTA_ARTIFACT_DB": str(home / "registry.sqlite3"),
            "BATTUTA_ARTIFACT_BASE_URL": "https://artifacts.example.test/artifacts",
            "PATH": f"{os.path.dirname(sys.executable)}{os.pathsep}{os.environ['PATH']}"}


@pytest.fixture
def run(env):
    """Run a command to completion; fail unless it exits 0 and return its stdout."""
    def invoke(*command):
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr + result.stdout
        return result.stdout
    return invoke


@pytest.fixture
def cli(run, env):
    """The battuta-artifact CLI with JSON output, against the migrated registry."""
    run(*ARTIFACT, "setup", "--json")
    return lambda *args: json.loads(run(*ARTIFACT, *args, "--json"))


@pytest.fixture
def get(cli, env, tmp_path):
    """GET a path from the real server; HTTP errors are returned as their status code."""
    with (tmp_path / "server.log").open("w+") as log:
        process = subprocess.Popen([*ARTIFACT, "serve", "--port", "0"], env=env, stdout=log, stderr=log)
        try:
            deadline, address = time.monotonic() + 10, None
            while address is None and time.monotonic() < deadline and process.poll() is None:
                log.seek(0)
                match = re.search(r"http://127\.0\.0\.1:(\d+)", log.read())
                address = match and match.group()
                time.sleep(0.05)
            assert address, "service failed to start; see server.log"

            def fetch(path):
                try:
                    with urlopen(address + path, timeout=4) as response:
                        return response.read().decode()
                except HTTPError as error:
                    return error.code
            fetch.address = address
            yield fetch
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
