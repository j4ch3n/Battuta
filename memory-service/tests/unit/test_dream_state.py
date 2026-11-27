import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from battuta_memory import dream
from battuta_memory.config import MemoryConfig
from battuta_memory.dream import DreamState


class DreamStateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.config = MemoryConfig(data_dir=Path(directory.name))
        self.state = DreamState(self.config.store_dir)

    def test_second_start_reports_already_running(self):
        self.state.start(os.getpid())
        with mock.patch.object(dream.subprocess, "Popen") as popen:
            self.assertEqual(dream.start_dream(self.config)["status"], "already_running")
        popen.assert_not_called()

    def test_dead_pid_is_reported_failed_and_can_restart(self):
        finished = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True, check=True)
        self.state.start(int(finished.stdout))
        state = self.state.read()
        self.assertEqual((state["status"], state["error"]), ("failed", "dream worker stopped unexpectedly"))
        with mock.patch.object(dream.subprocess, "Popen", return_value=mock.Mock(pid=os.getpid())) as popen:
            self.assertEqual(dream.start_dream(self.config)["status"], "started")
        self.assertEqual(popen.call_args.args[0][1:], ["-m", "battuta_memory.cli", "dream", "run"])

    def test_status_keeps_last_success_across_failure(self):
        self.state.start(os.getpid())
        self.state.finish(True, report={})
        success = self.state.read()["last_success_at"]
        self.state.start(os.getpid())
        self.state.finish(False, "boom")
        self.assertEqual(self.state.read()["last_success_at"], success)
        self.assertEqual(self.state.read()["status"], "failed")

    def test_idle_before_first_dream(self):
        self.assertEqual(self.state.read()["status"], "idle")
        self.assertIsNone(self.state.read()["last_success_at"])


if __name__ == "__main__":
    unittest.main()
