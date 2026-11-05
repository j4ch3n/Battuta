"""Real installed CLI project operations preserve unrelated work material."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ProjectCommandsTests(unittest.TestCase):
    def test_project_operations_preserve_shared_files_and_opaque_metadata(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as temp:
            home = Path(temp)
            env = {**os.environ, "HOME": str(home), "LINEAR_API_TOKEN": "test-token"}
            def cli(*args):
                result = subprocess.run([str(Path(sys.executable).with_name("battuta-project")), *args], cwd=home, env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout
            cli("init", "atlas")
            cli("init", "harbor")
            root = home / ".battuta/projects"
            path = root / ".config.json"
            state = json.loads(path.read_text())
            state["projects"] = {"atlas": {"private": [1, 2, 3]}}
            path.write_text(json.dumps(state))
            notes = root / "atlas/work/a3f91c2e/note.md"
            notes.parent.mkdir(parents=True)
            notes.write_bytes(b"Private finding\n")
            self.assertIn("atlas", cli("list"))
            cli("switch", "atlas")
            self.assertIn("atlas", cli("current"))
            self.assertIn("atlas", cli("explain"))
            cli("github", "link", "https://github.com/team/atlas")
            cli("linear", "link", "project-id,team-id")
            self.assertEqual(json.loads(path.read_text())["projects"], state["projects"])
            self.assertEqual(notes.read_bytes(), b"Private finding\n")


if __name__ == "__main__":
    unittest.main()
