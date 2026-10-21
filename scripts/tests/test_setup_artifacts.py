"""Exercise artifact provisioning without installing into the real host."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]


class ArtifactSetupTests(unittest.TestCase):
    def test_source_setup_installs_locked_dependencies_then_runs_migrations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            shutil.copy2(ROOT / "scripts/setup-artifacts.sh", root / "scripts/setup-artifacts.sh")
            binary = root / "bin"
            binary.mkdir()
            venv = root / "artifact-service/.venv/bin"
            venv.mkdir(parents=True)
            for path in [binary / "uv", venv / "battuta-artifact"]:
                path.write_text('#!/usr/bin/env python3\nimport json, os, sys\nwith open(os.environ["CALLS"], "a") as f: f.write(json.dumps(sys.argv) + "\\n")\n')
                path.chmod(0o755)
            log = root / "calls"
            result = subprocess.run(["bash", str(root / "scripts/setup-artifacts.sh")],
                                    env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "CALLS": str(log)},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(calls[0][1:3], ["sync", "--project"])
            self.assertIn("--locked", calls[0])
            self.assertIn("--no-dev", calls[0])
            self.assertEqual(calls[-1][1:], ["setup"])

    def test_setup_rejects_unknown_arguments(self):
        result = subprocess.run(["bash", str(ROOT / "scripts/setup-artifacts.sh"), "--unknown"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
