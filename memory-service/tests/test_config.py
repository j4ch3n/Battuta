import os
import unittest
from pathlib import Path
from unittest.mock import patch

from battuta_memory.config import MemoryConfig


class ConfigTests(unittest.TestCase):
    def test_data_path_never_defaults_to_stone(self):
        with patch.dict(os.environ, {"PI_MEMORY_STONE_DB_PATH": "/old/memory.db"}, clear=True):
            config = MemoryConfig.from_env()
        self.assertEqual(config.database, Path.home() / ".battuta/memory-service/memory.db")
        self.assertEqual((config.host, config.port), ("127.0.0.1", 8901))

    def test_remote_host_rejected(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            MemoryConfig(host="0.0.0.0")
