# Shared speech operations

One local MCP server at `http://127.0.0.1:8902/mcp` serves CoS and Workers;
Manager's speech connection is disabled. `transcribe_audio` accepts a base64
audio file and returns a transcript. `synthesize_speech` accepts English text
and returns base64 OGG/Opus audio. The tools do not send Telegram messages.
The service loads SenseVoice Small INT8 and Pocket TTS once per process. It
accepts at most 10 MB and 120 seconds of audio or 4,000 text characters; one
request per engine runs at a time and excess requests fail instead of queueing.
These limits and two inference threads per engine are provisional pending the
Oracle A1 benchmark.

Speech inference stays local, but transcripts passed to cloud-backed agents may
leave the host. Audio conversion uses pipes, not persistent recordings. Access
to loopback and bot configuration is not a security boundary between processes
under the same OS user. Logs must not contain audio or transcriptions.

SenseVoice model licensing is described by [FunASR](https://github.com/modelscope/FunASR#license).
Pocket TTS is from [Kyutai](https://huggingface.co/kyutai/pocket-tts), with
the sherpa-onnx ONNX export. The default voice is Alba MacKenna's
[casual recording](https://huggingface.co/kyutai/tts-voices), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It is used
unmodified as a reference. Review applicable model and voice terms before use.

Actual ARM64 compatibility, concurrency, speech quality, and CPU/RAM usage must
be confirmed on the target host. Stop on incompatibility; do not fall back to a
hosted speech provider or silently substitute a model.
