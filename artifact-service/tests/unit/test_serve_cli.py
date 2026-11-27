from unittest.mock import patch

from click.testing import CliRunner

from battuta_artifacts.cli import main
from battuta_artifacts.registry import migrate


def test_serve_defaults_are_local_only_and_setup_is_not_implicit(tmp_path):
    path = tmp_path / "registry.sqlite3"
    runner = CliRunner(env={"BATTUTA_ARTIFACT_DB": str(path)})
    with patch("uvicorn.run") as run:
        result = runner.invoke(main, ["serve"])
        assert result.exit_code == 5, result.output
        assert not path.exists()
        run.assert_not_called()
        migrate(path)
        result = runner.invoke(main, ["serve"])
        assert result.exit_code == 0, result.output
        assert run.call_args.kwargs["host"] == "127.0.0.1"
        assert run.call_args.kwargs["port"] == 8000
        assert "reload" not in run.call_args.kwargs
