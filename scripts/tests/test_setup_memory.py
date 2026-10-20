import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("setup_memory", Path(__file__).parents[1] / "setup-memory.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class MemorySetupTests(unittest.TestCase):
    def test_supported_platforms(self):
        setup.validate_platform("Linux", "aarch64", 64, ("glibc", "2.36"))
        setup.validate_platform("Darwin", "arm64", 64, ("", ""))

    def test_unsupported_platforms_fail_with_remediation(self):
        for machine, bits, libc in (("armv7l", 32, ("glibc", "2.36")), ("aarch64", 64, ("glibc", "2.27")), ("aarch64", 64, ("musl", "1.2"))):
            with self.subTest(machine=machine, libc=libc), self.assertRaisesRegex(RuntimeError, "64-bit Raspberry Pi OS"):
                setup.validate_platform("Linux", machine, bits, libc)

    def test_setup_uses_locked_managed_python_not_system_pip(self):
        commands = []
        with patch.object(setup, "run", side_effect=lambda args: commands.append(args)), patch.object(setup, "validate_platform"), patch.object(Path, "read_text", return_value='[[package]]\nname="battuta-memory"\n[[package]]\nname="onnxruntime"\n'):
            setup.setup(Path("/source"), archive=None)
        self.assertEqual(commands[0], ["uv", "sync", "--project", "/source/memory-service", "--locked", "--no-dev", "--managed-python", "--python", "3.12", "--no-build-package", "onnxruntime"])
        self.assertIn("model", commands[-2])
        self.assertIn("install", commands[-2])
        self.assertIn("doctor", commands[-1])
