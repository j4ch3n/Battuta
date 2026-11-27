import base64

import pytest

from battuta_speech.service import SpeechService


class Engine:
    def transcribe(self, data):
        return data.decode()

    def synthesize(self, text):
        return text.encode()


def test_round_trip():
    service = SpeechService(Engine())
    assert service.transcribe(base64.b64encode(b"hello").decode()) == "hello"
    assert service.synthesize("hello") == b"hello"


@pytest.mark.parametrize("data", ["!", "", "Y" * (16 * 1024 * 1024)])
def test_rejects_invalid_audio(data):
    with pytest.raises(ValueError):
        SpeechService(Engine()).transcribe(data)


@pytest.mark.parametrize("text", ["", " " * 5, "x" * 4001])
def test_rejects_invalid_text(text):
    with pytest.raises(ValueError):
        SpeechService(Engine()).synthesize(text)
