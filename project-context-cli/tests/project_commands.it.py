"""Real installed CLI project operations preserve unrelated work material."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml


class ProjectCommandsTests(unittest.TestCase):
    def test_concurrent_explicit_project_operations_preserve_each_projects_files(self):
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
            sentinels = {}
            for name in ("atlas", "harbor"):
                for relative in ("work/a3f91c2e/note.md", "specs/api/spec-v1.md", "specs/.config.json"):
                    path = root / name / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(f"Private {name} {relative}\n".encode())
                    sentinels[path] = path.read_bytes()
            self.assertIn("atlas", cli("list"))
            for operation in ("explain", "github", "linear"):
                processes = []
                for name in ("atlas", "harbor"):
                    args = {
                        "explain": ["explain", name],
                        "github": ["github", "link", name, f"https://github.com/team/{name}"],
                        "linear": ["linear", "link", name, f"{name}-project,{name}-team"],
                    }[operation]
                    processes.append((name, subprocess.Popen(
                        [str(Path(sys.executable).with_name("battuta-project")), *args],
                        cwd=home, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    )))
                for name, process in processes:
                    output, error = process.communicate(timeout=15)
                    self.assertEqual(process.returncode, 0, error)
                    if operation == "explain":
                        self.assertIn(str(root / name / "code").replace(str(home), "~"), output)
            for name in ("atlas", "harbor"):
                config = yaml.safe_load((root / name / "project.yaml").read_text())
                self.assertNotIn("project", config)
                self.assertEqual(config["github"]["repository"], f"team/{name}")
                self.assertEqual(config["linear"], {"project_id": f"{name}-project", "team_id": f"{name}-team"})
            for path, original in sentinels.items():
                self.assertEqual(path.read_bytes(), original)
            self.assertFalse((root / ".config.json").exists())
            self.assertFalse((root / ".config.lock").exists())


if __name__ == "__main__":
    unittest.main()
