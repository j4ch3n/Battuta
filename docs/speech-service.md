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

## Telegram voice replies

The pi-telegram voice handler calls `POST http://127.0.0.1:8902/tts` on the
speech service. The request body is the UTF-8 reply text, at most 4,000
characters. The response is raw `audio/ogg` (OGG/Opus), which Telegram accepts
as a native voice note without conversion. The route shares the same synthesis
code and single-request guard as `synthesize_speech`. Errors are plain text:
`400` for empty, invalid, or too-long text; `413` for oversized bodies; `503`
when the service is busy or not ready.

pi-telegram (0.59.2 or later) runs configured `outboundHandlers` with
`type: "voice"` before any registered synthesis provider. Add this top-level
entry to CoS's `.pi/telegram.json`, next to `profiles`; `make refresh-telegram`
updates only `profiles.default` and preserves other top-level keys:

```json
{
  "outboundHandlers": [
    {
      "type": "voice",
      "template": "curl -sf --data-binary @- -H 'Content-Type: text/plain' http://127.0.0.1:8902/tts -o {ogg}",
      "output": "ogg"
    }
  ]
}
```

- The bridge sends the reply text on stdin; `--data-binary @-` posts it. `-f`
  makes an HTTP error a command failure, so the bridge falls back to a text reply.
- `output: "ogg"` makes the bridge read the artifact path from `{ogg}`, which
  `curl -o` writes.
- `curl` must be on the Pi process's `PATH`; it is a standard host tool.
- Explicit `telegram_voice` actions and the `voice.replyMode` policy use this
  handler. The default reply mode stays `manual`, so ordinary replies are not
  converted automatically.
- The service accepts English text only. The handler has no language or rate
  options.

Check the route from the command line before a Telegram test. Expect a non-empty
OGG file and no Telegram or model call:

```sh
printf 'Voice check.' | curl -sf --data-binary @- -H 'Content-Type: text/plain' http://127.0.0.1:8902/tts -o /tmp/voice-check.ogg
test -s /tmp/voice-check.ogg && file /tmp/voice-check.ogg
```

Receipt in Telegram is separate evidence. Do not treat a generated or queued file
as confirmed delivery.
