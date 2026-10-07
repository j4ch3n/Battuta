"""Real project files with GitHub cloning stubbed at the process boundary."""

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from battuta_project.registry import ProjectRegistry


class ProjectTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        self.registry = ProjectRegistry()
        clone = patch("battuta_project.registry.subprocess.run", side_effect=self.clone_repo)
        clone.start()
        self.addCleanup(clone.stop)
        self.project = self.registry.init("atlas-api", github="https://github.com/team/atlas-api")

    @staticmethod
    def clone_repo(args, **kwargs):
        Path(args[4]).mkdir()
        return subprocess.CompletedProcess(args, 0)

    def file(self, relative: str, text: str = "") -> Path:
        path = self.project.code / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path
