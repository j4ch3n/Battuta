import subprocess
import struct

import pytest

from battuta_speech.audio import decode_audio, encode_audio


def test_rejects_invalid_audio():
    with pytest.raises(ValueError, match="audio"):
        decode_audio(b"not audio")


def test_limits_decoded_audio_duration(monkeypatch):
    class Result:
        returncode = 0
        stdout = b"\0" * (16000 * 2 * 121)

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: Result())
    with pytest.raises(ValueError, match="long"):
        decode_audio(b"audio")


def test_opus_round_trip():
    source = struct.pack("<f", 0.2) * 16000
    encoded = encode_audio(source, 16000)
    assert encoded.startswith(b"OggS")
    decoded = decode_audio(encoded)
    assert len(decoded) == 32000


def test_decoder_disallows_external_protocols(monkeypatch):
    def run(command, **kwargs):
        assert command[command.index("-protocol_whitelist") + 1] == "pipe"
        return subprocess.CompletedProcess(command, 0, b"\0\0")

    monkeypatch.setattr(subprocess, "run", run)
    assert decode_audio(b"audio") == b"\0\0"
