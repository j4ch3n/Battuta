"""Convert audio through FFmpeg without writing recordings to disk."""

import subprocess

MAX_AUDIO_SECONDS = 300


def decode_audio(data: bytes) -> bytes:
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-protocol_whitelist", "pipe", "-i", "pipe:0", "-t", str(MAX_AUDIO_SECONDS + 1), "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
            input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("Cannot decode audio") from error
    if result.returncode or not result.stdout:
        raise ValueError("Unsupported or malformed audio")
    if len(result.stdout) > 16000 * 2 * MAX_AUDIO_SECONDS:
        raise ValueError(f"Audio is too long (maximum {MAX_AUDIO_SECONDS} seconds)")
    return result.stdout


def encode_audio(samples: bytes, sample_rate: int) -> bytes:
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-f", "ogg", "pipe:1"],
            input=samples, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("Cannot encode audio") from error
    if result.returncode or not result.stdout:
        raise RuntimeError("Cannot encode audio")
    return result.stdout
