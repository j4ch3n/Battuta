# Shared speech operations

One local server at `http://127.0.0.1:8902` serves CoS and Workers through MCP at
`/mcp`, and a plain REST route at `POST /tts` for text-to-OGG callers;
Manager's speech connection is disabled. `transcribe_audio` accepts a base64
audio file and returns a transcript. `synthesize_speech` accepts English text
and returns base64 OGG/Opus audio. The tools do not send Telegram messages.
The service loads SenseVoice Small INT8 and Pocket TTS once per process. It
accepts at most 10 MB and 300 seconds of audio or 4,000 text characters.
Transcription splits audio into 30-second chunks that advance 25 seconds, so
neighbouring chunks overlap by 5 seconds. Each chunk carries its index. Chunks
wait in an in-memory queue and are decoded by five SenseVoice recognizers in
parallel; the transcripts are joined in index order with spaces and returned in
one response. Transcription requests are not capped. Synthesis runs one request
at a time, and excess requests fail. Two inference threads per recognizer are
provisional.

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

## REST text-to-OGG route

`POST /tts` takes a UTF-8 text body of at most 4,000 characters and returns raw
`audio/ogg` (OGG/Opus). It shares the synthesis code and single-request guard
used by `synthesize_speech`. Errors are plain text: `400` for empty, invalid, or
too-long text; `413` for oversized bodies; `503` when the service is busy or not
ready.
