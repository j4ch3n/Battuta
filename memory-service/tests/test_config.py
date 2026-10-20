import os
import unittest
from pathlib import Path
from unittest.mock import patch

from battuta_memory.config import MemoryConfig


class ConfigTests(unittest.TestCase):
    def test_default_database_uses_shared_memory_directory(self):
        with patch.dict(os.environ, {}, clear=True):
            config = MemoryConfig.from_env()
            default = MemoryConfig()
        self.assertEqual(config.database, Path.home() / ".battuta/memory/memory.db")
        self.assertEqual(default.database, config.database)
        self.assertEqual((config.host, config.port), ("127.0.0.1", 8901))

    def test_explicit_data_directory_is_preserved(self):
        with patch.dict(os.environ, {"BATTUTA_MEMORY_DATA_DIR": "/custom/memory"}, clear=True):
            self.assertEqual(MemoryConfig.from_env().database, Path("/custom/memory/memory.db"))

    def test_remote_host_rejected(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            MemoryConfig(host="0.0.0.0")
