# Speech service installation

The speech MCP service runs locally for CoS and Workers on Oracle Linux ARM64.
Install the `battuta-speech` and `battuta-packaging` release wheels as described
in the release guide. Ask the administrator to provide FFmpeg with OGG/Opus
support before setup; do not modify system packages during setup.

```sh
command -v ffmpeg
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus
battuta-packaging install-speech
battuta-packaging verify-speech
```

Every command must succeed. Packaging downloads pinned model archives and a
reference voice, validates SHA-256, and installs the required files under
`~/.battuta/speech-service/`. It reuses a verified installation and refuses to
overwrite unknown or damaged data. Runtime never downloads weights. The
directory is persistent and must not be removed when replacing a release.

`battuta-packaging install-services` writes the user unit without activating it.
Once approved, use `systemctl --user daemon-reload` and
`systemctl --user enable --now battuta-speech.service`. Check readiness with
`curl -fsS http://127.0.0.1:8902/health`. A successful response reports
`{"ready":true}`. Do not start bots or invoke models as a setup check.

See [speech operations](speech-service.md) for the tool and privacy contract.
