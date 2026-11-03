import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[3]


class MemoryUnitTests(unittest.TestCase):
    def test_units_are_idempotent_and_memory_is_not_required_by_bots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            env = {**os.environ, "HOME": directory, "XDG_CONFIG_HOME": str(root / "config")}
            for _ in range(2):
                result = subprocess.run([sys.executable, "-m", "battuta_packaging.cli", "install-services", "--root", str(root)], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            units = root / "config/systemd/user"
            memory = (units / "battuta-memory.service").read_text()
            self.assertIn(f"ExecStart={root.resolve()}/bin/battuta memory", memory)
            self.assertIn("MCP_MEMORY_ONNX_ALLOW_DOWNLOAD=false", memory)
            cos = (units / "battuta-cos.service").read_text()
            self.assertIn("Wants=network-online.target battuta-memory.service", cos)
            self.assertNotIn("Requires=", cos)
            artifacts = (units / "battuta-artifacts.service").read_text()
            self.assertIn(f"ExecStart={root.resolve()}/bin/battuta artifacts", artifacts)
            self.assertNotIn("ExecStartPre=", artifacts)
            self.assertIn("Restart=on-failure", artifacts)
            self.assertIn("NoNewPrivileges=true", artifacts)
            self.assertIn("ProtectSystem=strict", artifacts)
            self.assertNotIn("setup", artifacts)

    def test_conflicting_unit_prevents_all_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            units = root / "systemd/user"
            units.mkdir(parents=True)
            (units / "battuta-memory.service").write_text("owner customized unit")
            result = subprocess.run([sys.executable, "-m", "battuta_packaging.cli", "install-services", "--root", str(root)], env={**os.environ, "XDG_CONFIG_HOME": directory}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(units.iterdir()), [units / "battuta-memory.service"])
