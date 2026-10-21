import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner


class ServeCliTests(unittest.TestCase):
    def test_serve_defaults_are_local_only_and_setup_is_not_implicit(self):
        from battuta_artifacts.cli import main
        from battuta_artifacts.registry import migrate

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.sqlite3"
            runner = CliRunner(env={"BATTUTA_ARTIFACT_DB": str(path)})
            with patch("uvicorn.run") as run:
                result = runner.invoke(main, ["serve"])
                self.assertEqual(result.exit_code, 5, result.output)
                self.assertFalse(path.exists())
                run.assert_not_called()
                migrate(path)
                result = runner.invoke(main, ["serve"])
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")
                self.assertEqual(run.call_args.kwargs["port"], 8000)
                self.assertNotIn("reload", run.call_args.kwargs)
