import tomllib

import pytest
from click.testing import CliRunner

from battuta_packaging.cli import main
from battuta_packaging.wheel_metadata import PROJECTS
from fixtures import ROOT


def test_verify_speech_reports_missing_assets(tmp_path, monkeypatch):
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    result = CliRunner().invoke(main, ["verify-speech"])
    assert result.exit_code != 0
    assert "missing or invalid" in result.output


@pytest.mark.parametrize("wheel", ["battuta-doc", "battuta-speech"], ids=["doc", "speech"])
def test_release_wheel_is_registered(wheel):
    project = ROOT / PROJECTS[wheel]
    assert tomllib.loads((project / "pyproject.toml").read_text())["project"]["name"] == wheel
