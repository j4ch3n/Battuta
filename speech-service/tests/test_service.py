import base64
import threading

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
    assert base64.b64decode(service.synthesize("hello")) == b"hello"


@pytest.mark.parametrize("data", ["!", "", "Y" * (16 * 1024 * 1024)])
def test_rejects_invalid_audio(data):
    with pytest.raises(ValueError):
        SpeechService(Engine()).transcribe(data)


@pytest.mark.parametrize("text", ["", " " * 5, "x" * 4001])
def test_rejects_invalid_text(text):
    with pytest.raises(ValueError):
        SpeechService(Engine()).synthesize(text)


def test_rejects_overload_instead_of_queuing():
    entered = threading.Event()
    release = threading.Event()

    class Busy(Engine):
        def transcribe(self, data):
            entered.set()
            release.wait(5)
            return "ok"

    service = SpeechService(Busy())
    thread = threading.Thread(target=lambda: service.transcribe("YQ=="))
    thread.start()
    try:
        assert entered.wait(2)
        with pytest.raises(RuntimeError, match="busy"):
            service.transcribe("YQ==")
    finally:
        release.set()
        thread.join()
