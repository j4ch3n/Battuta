import subprocess

import pytest

from battuta_speech.audio import decode_audio


@pytest.mark.parametrize("outcome", [
    subprocess.CompletedProcess([], 1, b""),
    subprocess.CompletedProcess([], 0, b""),
    OSError("ffmpeg missing"),
    subprocess.TimeoutExpired("ffmpeg", 60),
], ids=["nonzero-exit", "empty-output", "binary-missing", "timeout"])
def test_decoder_failures_become_value_error(monkeypatch, outcome):
    def run(*args, **kwargs):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(ValueError, match="audio"):
        decode_audio(b"not audio")


def test_limits_decoded_audio_duration(monkeypatch):
    class Result:
        returncode = 0
        stdout = b"\0" * (16000 * 2 * 301)

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: Result())
    with pytest.raises(ValueError, match="300 seconds"):
        decode_audio(b"audio")


def test_decoder_disallows_external_protocols(monkeypatch):
    def run(command, **kwargs):
        assert command[command.index("-protocol_whitelist") + 1] == "pipe"
        return subprocess.CompletedProcess(command, 0, b"\0\0")

    monkeypatch.setattr(subprocess, "run", run)
    assert decode_audio(b"audio") == b"\0\0"
