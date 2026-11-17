"""Long-lived CPU speech engines."""

import queue
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import sherpa_onnx

from .audio import decode_audio, encode_audio

SAMPLE_RATE = 16000
RECOGNIZERS = 5
CHUNK_SECONDS = 30
CHUNK_STEP_SECONDS = 25


def chunk_bounds(length: int) -> list[tuple[int, int]]:
    size = CHUNK_SECONDS * SAMPLE_RATE
    step = CHUNK_STEP_SECONDS * SAMPLE_RATE
    last = max(length - size, 0)
    return [(start, min(start + size, length)) for start in [*range(0, last, step), last]]


class SpeechEngine:
    def __init__(self, root: Path):
        asr = root / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
        tts = root / "sherpa-onnx-pocket-tts-int8-2026-01-26"
        self.recognizers = queue.Queue()
        for _ in range(RECOGNIZERS):
            self.recognizers.put(sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(asr / "model.int8.onnx"), tokens=str(asr / "tokens.txt"),
                num_threads=2, use_itn=True, debug=False,
            ))
        self.chunks = ThreadPoolExecutor(max_workers=RECOGNIZERS)
        model = sherpa_onnx.OfflineTtsPocketModelConfig(
            lm_flow=str(tts / "lm_flow.int8.onnx"), lm_main=str(tts / "lm_main.int8.onnx"),
            encoder=str(tts / "encoder.onnx"), decoder=str(tts / "decoder.int8.onnx"),
            text_conditioner=str(tts / "text_conditioner.onnx"),
            vocab_json=str(tts / "vocab.json"), token_scores_json=str(tts / "token_scores.json"),
        )
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(pocket=model, num_threads=2, provider="cpu")
        )
        if not config.validate():
            raise ValueError("Pocket TTS model configuration is invalid")
        self.tts = sherpa_onnx.OfflineTts(config)
        self.reference = np.frombuffer(decode_audio((root / "voice.wav").read_bytes()), dtype="<i2").astype(np.float32) / 32768.0

    def transcribe(self, data: bytes) -> str:
        samples = np.frombuffer(decode_audio(data), dtype="<i2").astype(np.float32) / 32768.0
        bounds = chunk_bounds(len(samples))
        futures = [self.chunks.submit(self._decode, index, samples[start:end]) for index, (start, end) in enumerate(bounds)]
        parts = [None] * len(futures)
        for future in futures:
            index, text = future.result()
            parts[index] = text
        return " ".join(part.strip() for part in parts if part.strip())

    def _decode(self, index: int, samples: np.ndarray) -> tuple[int, str]:
        recognizer = self.recognizers.get()
        try:
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, samples)
            recognizer.decode_stream(stream)
            return index, stream.result.text
        finally:
            self.recognizers.put(recognizer)

    def synthesize(self, text: str) -> bytes:
        config = sherpa_onnx.GenerationConfig()
        config.reference_audio = self.reference
        config.reference_sample_rate = 16000
        config.num_steps = 5
        result = self.tts.generate(text, config)
        if not len(result.samples):
            raise RuntimeError("Speech generation failed")
        return encode_audio(np.asarray(result.samples, dtype="<f4").tobytes(), result.sample_rate)
