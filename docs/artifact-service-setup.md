# Artifact service setup

Run as the ordinary account that owns the artifacts. Requires Python 3.12+ and uv. Do not run a second process on the same port. No Cloudflare configuration is created or changed by setup.

## Install and migrate

From a source checkout:

```sh
bash scripts/setup-artifacts.sh
export PATH="$PWD/artifact-service/.venv/bin:$PATH"
```

From an extracted release:

```sh
bin/battuta setup-artifacts
export PATH="$PWD/artifact-service/.venv/bin:$PATH"
```

Source setup installs locked dependencies. Release setup verifies bundled wheel checksums and installs dependencies offline; Python/uv must already be available. Both explicitly apply Alembic migrations, preserve registrations, and do not start/restart any service. For upgrades, stop the artifact service and back up the registry first, then rerun setup and restart it. `battuta-artifact setup` applies migrations when the package is already installed.

Use the same `BATTUTA_ARTIFACT_DB` value across setup, CLI, and service if overriding the default. A systemd environment override is not automatically inherited by your terminal or bots. Artifact commands do not load `.env.prod` themselves.

## Launch

For a foreground source-checkout check:

```sh
battuta-artifact serve
```

The default binding is `127.0.0.1:8000`; `--port` permits an alternative local test port. There is no public-host binding option. Stop this foreground process before enabling the background service.

For a Linux release, create the optional user units with `bin/battuta install-services`, then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now battuta-artifacts.service
systemctl --user status battuta-artifacts.service
journalctl --user -u battuta-artifacts.service -n 50
```

The unit restarts on failure and mounts the filesystem read-only within its namespace. User-service sandbox support depends on the host's namespace configuration; inspect systemd errors rather than silently disabling protection. To run while logged out/at boot, ask the operator to enable lingering for this account according to host policy. No service installation, activation, or lingering is performed automatically. For a source checkout, use the foreground command under the host's supervisor; the packaged unit targets the release's `bin/battuta` launcher. macOS development uses the foreground command or an operator-managed launchd job.

Production bot launch adds the artifact virtual environment to PATH; the source tmux launcher does so for PM. Restart existing bot sessions to pick it up. Standalone sessions need the PATH export above.

## Verify

```sh
battuta-artifact list --json
curl -f http://127.0.0.1:8000/artifacts/
curl -N http://127.0.0.1:8000/artifacts/events
```

Confirm schema setup occurred before starting the server. Through the existing tunnel, check the index, an HTML bundle with relative JS/CSS, a Markdown image, and registration/deregistration while the index is open. The tunnel must preserve `/artifacts/...`; check browser network traffic for successful events or five-second catalog refreshes. Ensure Cloudflare caching rules honor `no-store`, and apply Access if pages are private. No remote tunnel verification is implied by passing local tests.
