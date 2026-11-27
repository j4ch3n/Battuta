import queue
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest

from battuta_speech import engines


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (0, [(0, 0)]),
        (30, [(0, 30 * 16000)]),
        (55, [(0, 30 * 16000), (25 * 16000, 55 * 16000)]),
        (300, [(s * 16000, (s + 30) * 16000) for s in [*range(0, 270, 25), 270]]),
    ],
    ids=["empty", "single-chunk", "two-chunks", "many-chunks"],
)
def test_chunks_cover_audio_with_overlap(seconds, expected):
    assert engines.chunk_bounds(seconds * 16000) == expected


def test_transcription_joins_chunk_results_in_order(monkeypatch):
    class Stream:
        def __init__(self, samples):
            self.result = type("Result", (), {"text": f"{len(samples)}"})()

        def accept_waveform(self, rate, samples):
            assert rate == 16000
            self.samples = samples

    class Recognizer:
        def create_stream(self):
            return Stream([])

        def decode_stream(self, stream):
            stream.result.text = f" {len(stream.samples)} "

    engine = engines.SpeechEngine.__new__(engines.SpeechEngine)
    engine.recognizers = queue.Queue()
    engine.recognizers.put(Recognizer())
    engine.chunks = ThreadPoolExecutor(max_workers=1)
    monkeypatch.setattr(engines, "decode_audio", lambda data: np.zeros(55 * 16000, dtype="<i2").tobytes())
    assert engine.transcribe(b"audio") == f"{30 * 16000} {30 * 16000}"
    engine.chunks.shutdown()


def test_transcription_keeps_chunk_order_when_chunks_finish_out_of_order(monkeypatch):
    import time

    class Stream:
        result = type("Result", (), {"text": ""})()

        def accept_waveform(self, rate, samples):
            self.tag = round(float(samples[0]) * 32768)

    class Recognizer:
        def create_stream(self):
            return Stream()

        def decode_stream(self, stream):
            index = [0, 25, 50, 70].index(stream.tag)
            time.sleep((3 - index) * 0.02)
            stream.result = type("Result", (), {"text": f"chunk{index}"})()

    engine = engines.SpeechEngine.__new__(engines.SpeechEngine)
    engine.recognizers = queue.Queue()
    for _ in range(engines.RECOGNIZERS):
        engine.recognizers.put(Recognizer())
    engine.chunks = ThreadPoolExecutor(max_workers=engines.RECOGNIZERS)
    audio = np.repeat(np.arange(100), 16000).astype("<i2")
    monkeypatch.setattr(engines, "decode_audio", lambda data: audio.tobytes())
    assert engine.transcribe(b"audio") == "chunk0 chunk1 chunk2 chunk3"
    engine.chunks.shutdown()
