"""Support-check discovery executes dotted Python integration filenames."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class SupportChecksTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        for name in ("scripts/checks/check-support.mjs", "scripts/packaging/battuta", "scripts/bot_setup/run-dev.sh",
                     "scripts/setup-memory.sh", "scripts/setup-artifacts.sh", "scripts/bot_setup/run-worker.sh"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if name == "scripts/checks/check-support.mjs":
                shutil.copyfile(ROOT / name, path)
            else:
                path.touch()
        for directory in ("scripts/bot_setup/tests", "scripts/packaging/tests", "memory-service/tests", "artifact-service/tests", "project-context-cli/tests"):
            folder = self.root / directory
            folder.mkdir(parents=True)
            (folder / "test_unit.py").touch()
            (folder / "a.it.py").touch()
            (folder / "b.it.py").touch()
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        uv = bin_dir / "uv"
        uv.write_text(f"#!{sys.executable}\n" +
                      "import json, os, sys\n"
                      "with open(os.environ['UV_LOG'], 'a') as log:\n"
                      "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                      "sys.exit(9 if os.environ.get('UV_FAIL_IT') and sys.argv[-1].endswith('.it.py') else 0)\n")
        uv.chmod(0o700)
        self.log = self.root / "uv.log"
        self.env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "UV_LOG": str(self.log)}

    def run_checks(self, **env):
        result = subprocess.run(["node", "scripts/checks/check-support.mjs"], cwd=self.root,
                                env={**self.env, **env}, capture_output=True, text=True, timeout=15)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, calls

    def test_runs_unit_discovery_and_each_integration_in_its_package_environment(self):
        result, calls = self.run_checks()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 15)
        for index, project in enumerate(("scripts/bot_setup", "scripts/packaging", "memory-service", "artifact-service", "project-context-cli")):
            group = calls[index * 3:index * 3 + 3]
            prefix = ["run", "--project", str(self.root / project), "--locked"]
            self.assertTrue(all(call[:len(prefix)] == prefix for call in group), group)
            self.assertIn("pytest" if project.startswith("scripts/") else "discover", group[0])
            self.assertTrue(group[1][-1].endswith("/a.it.py"), group)
            self.assertTrue(group[2][-1].endswith("/b.it.py"), group)

    def test_integration_failure_stops_checks_and_preserves_exit_status(self):
        result, calls = self.run_checks(UV_FAIL_IT="1")
        self.assertEqual(result.returncode, 9, result.stdout + result.stderr)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[-1][-1].endswith("/a.it.py"), calls)
