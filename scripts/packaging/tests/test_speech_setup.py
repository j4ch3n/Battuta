from click.testing import CliRunner

from battuta_packaging.cli import main


def test_verify_speech_reports_missing_assets(tmp_path, monkeypatch):
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    result = CliRunner().invoke(main, ["verify-speech"])
    assert result.exit_code != 0
    assert "missing or invalid" in result.output


def test_speech_release_wheel_is_registered():
    from battuta_packaging.wheel_metadata import PROJECTS

    assert PROJECTS["battuta-speech"] == "speech-service"
