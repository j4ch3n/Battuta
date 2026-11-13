"""Bounded speech operations shared by all MCP clients."""

import base64
import binascii
from threading import BoundedSemaphore


class SpeechService:
    def __init__(self, engine):
        self.engine = engine
        self.stt = BoundedSemaphore(1)
        self.tts = BoundedSemaphore(1)

    def transcribe(self, audio: str) -> str:
        if not audio or len(audio) > 14_000_000:
            raise ValueError("Audio is empty or too large")
        try:
            data = base64.b64decode(audio, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Audio must be base64 encoded") from error
        if not data or len(data) > 10_000_000:
            raise ValueError("Audio is empty or too large")
        if not self.stt.acquire(blocking=False):
            raise RuntimeError("Speech recognition is busy; retry later")
        try:
            return self.engine.transcribe(data)
        finally:
            self.stt.release()

    def synthesize(self, text: str) -> str:
        if not text.strip() or len(text) > 4000:
            raise ValueError("Text is empty or too long")
        if not self.tts.acquire(blocking=False):
            raise RuntimeError("Speech synthesis is busy; retry later")
        try:
            return base64.b64encode(self.engine.synthesize(text)).decode("ascii")
        finally:
            self.tts.release()
