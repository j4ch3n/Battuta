# Artifact service setup

Run as the ordinary account that owns the artifacts. Requires Python 3.12+ and uv. Do not run a second process on the same port. No Cloudflare configuration is created or changed by setup.

## Install and provision

From a source checkout:

```sh
bash scripts/setup-artifacts.sh
export PATH="$PWD/artifact-service/.venv/bin:$PATH"
```

For an extracted release, first install the separate `battuta-artifacts` wheel
with `uv tool install --managed-python --python 3.12`, using the verified wheel.
Its metadata declares the pinned runtime requirements and same-release project
wheel URL; no constraints or `--with` are required. Then provision:

```sh
export PATH="$(uv tool dir --bin):$PATH"
battuta-artifact setup
```

Source setup installs locked dependencies. Release setup uses the already
installed tool; it does not install Python packages or need CLI sources in the
archive. Both call `battuta-artifact setup` to apply pending Alembic migrations,
preserve registrations, and do not start/restart any service. New presentations
are drafts. Schema provisioning is explicit and does not start services; it is not
a bot-state migration or a database rollback mechanism.

Use the same `BATTUTA_ARTIFACT_DB` value across setup, CLI, and service if overriding the default. A systemd environment override is not automatically inherited by your terminal or bots. Artifact commands do not load `.env.prod` themselves.

## Launch

For a foreground source-checkout check:

```sh
battuta-artifact serve
```

The default binding is `127.0.0.1:8000`; `--port` permits an alternative local test port. There is no public-host binding option. Stop this foreground process before enabling the background service.

For a Linux release, generate units using `battuta-packaging install-services
--root DIR --env-file FILE --node PATH`. Only with operator approval:

```sh
systemctl --user daemon-reload
systemctl --user enable --now battuta-artifacts.service
systemctl --user status battuta-artifacts.service
journalctl --user -u battuta-artifacts.service -n 50
```

The unit restarts on failure and mounts the filesystem read-only within its namespace. User-service sandbox support depends on the host's namespace configuration; inspect errors rather than silently disabling protection. Ask the operator to enable lingering if needed. The unit uses installed `battuta-packaging run-component` to load the private environment and execute `battuta-artifact serve`. Source/macOS development uses the foreground command or an operator-managed supervisor.

Release user units include the uv tool directory on PATH for all bot roles; the
source tmux launcher uses the source artifact environment. Restart existing bot
sessions only with approval to pick up PATH changes. Standalone release sessions
need the uv tool PATH export above.

## Verify

```sh
battuta-artifact list --json >/dev/null
curl -fsS http://127.0.0.1:8000/artifacts/ >/dev/null
```

Run the first command after setup; run the second only with the local server
running. Both must exit zero. Stop if either fails; do not create registrations,
open a tunnel, or use a browser to recover setup validation. Tunnel, caching,
and access policy are deployment concerns outside this setup guide.
