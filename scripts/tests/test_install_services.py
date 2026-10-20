import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]


class MemoryUnitTests(unittest.TestCase):
    def test_units_are_idempotent_and_memory_is_not_required_by_bots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            shutil.copy2(ROOT / "packaging/install-services.mjs", root / "bin/install-services.mjs")
            env = {**os.environ, "HOME": directory, "XDG_CONFIG_HOME": str(root / "config")}
            for _ in range(2):
                result = subprocess.run(["node", str(root / "bin/install-services.mjs")], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            units = root / "config/systemd/user"
            memory = (units / "battuta-memory.service").read_text()
            self.assertIn(f"ExecStart={root.resolve()}/bin/battuta memory", memory)
            self.assertIn("MCP_MEMORY_ONNX_ALLOW_DOWNLOAD=false", memory)
            pm = (units / "battuta-pm.service").read_text()
            self.assertIn("Wants=network-online.target battuta-memory.service", pm)
            self.assertNotIn("Requires=", pm)

    def test_conflicting_unit_prevents_all_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            units = root / "systemd/user"
            units.mkdir(parents=True)
            (units / "battuta-memory.service").write_text("owner customized unit")
            result = subprocess.run(["node", str(ROOT / "packaging/install-services.mjs")], env={**os.environ, "XDG_CONFIG_HOME": directory}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(units.iterdir()), [units / "battuta-memory.service"])
