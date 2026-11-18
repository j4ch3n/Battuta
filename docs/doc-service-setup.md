# Document service installation

The document MCP service runs on the main bundle (Oracle Linux ARM64) for Claude Code sessions
that Workers delegate to. Install the `battuta-doc` and `battuta-packaging` release wheels as
described in the release guide, and install Claude Code so `claude` is on `PATH`; worker
configuration registers the service there and fails if `claude` is missing.

Models download on the service's first start into `~/.battuta/doc-service/models`. To have
them in place beforehand, run this once; it is idempotent:

```sh
battuta-doc install-models
```

`battuta-packaging install-services` writes `battuta-doc.service` without activating it. Once
approved, use `systemctl --user daemon-reload` and
`systemctl --user enable --now battuta-doc.service`. Keep `~/.battuta/doc-service/`
when replacing a release; it holds the models and converted results.

Checks, with no model or bot invocation:

```sh
test -d ~/.battuta/doc-service
curl -fsS http://127.0.0.1:8903/health
test -s ~/.battuta/doc-service/state.json
claude mcp get battuta-doc
```

`/health` answers with HTTP 503 and `"state":"warming_up"` while models download, then
`{"ready":true,...}`; `state.json` appears once the first model group is installed. A
`"state":"failed"` response carries the download error and retries on the next start.
`claude mcp get battuta-doc` must list `http://127.0.0.1:8903/mcp` with a timeout of
`1020000ms`. Stop and fix any check that fails.

See [document service operations](doc-service.md) for tools, limits and privacy.
