import numpy as np

from battuta_speech import engines


def test_transcription_passes_decoded_samples_to_recognizer(monkeypatch):
    class Stream:
        result = type("Result", (), {"text": "hello"})()

        def accept_waveform(self, rate, samples):
            assert rate == 16000
            assert len(samples) == 2

    class Recognizer:
        def create_stream(self):
            return Stream()

        def decode_stream(self, stream):
            pass

    engine = engines.SpeechEngine.__new__(engines.SpeechEngine)
    engine.recognizer = Recognizer()
    monkeypatch.setattr(engines, "decode_audio", lambda data: np.array([0, 1], dtype="<i2").tobytes())
    assert engine.transcribe(b"audio") == "hello"
