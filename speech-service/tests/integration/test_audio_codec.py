import shutil
import struct

import pytest

from battuta_speech.audio import decode_audio, encode_audio

pytestmark = pytest.mark.integration


def test_opus_round_trip():
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is not installed")
    source = struct.pack("<f", 0.2) * 16000
    encoded = encode_audio(source, 16000)
    assert encoded.startswith(b"OggS")
    assert len(decode_audio(encoded)) == 32000
