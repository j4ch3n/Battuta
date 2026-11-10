# Installing Pi extensions

For source development, install from the selected bot's directory with
`PI_CODING_AGENT_DIR` pointing to its `.pi` directory; `pi install -l` registers
the package in that bot's `.pi/settings.json`. Releases separate installed
packages/code from private state and use the release installation command; do not
install packages into `~/.battuta/pi-bots/`.

The source installation directory is not necessarily the runtime agent directory.
CoS runs from its checkout role with private configuration/authentication under
`~/.battuta/pi-bots/cos-bot/.pi/`; source workers likewise use the shared worker
role cwd and separate private agent directories. Keep environment-interpolated
settings private: a trusted project's settings layer is not interpolated.

## 1. Check requirements

Read the extension's published README and inspect its package metadata:

```sh
npm view <package-name>@<version> engines dependencies peerDependencies optionalDependencies --json
npm view <package-name>@<version> readme
```

Check the installed Node version against [Battuta's stack](tech-stack.md) and the extension's requirements. Identify external executables, native modules, provider credentials, and storage/configuration locations before installing. A peer dependency may already be supplied by Pi; verify resolution rather than installing a second runtime unnecessarily.

Pin the reviewed package version. Check which capabilities are implemented and which are optional or deferred; install dependencies for the capabilities being enabled.

## 2. Install for one bot

From the repository root, replace `<bot-name>`, `<package-name>`, and `<version>` with the selected bot and reviewed package:

```sh
PI_CODING_AGENT_DIR="$PWD/bots/<bot-name>/.pi" \
  pnpm --dir "bots/<bot-name>" exec pi install -l --approve "npm:<package-name>@<version>"

PI_CODING_AGENT_DIR="$PWD/bots/<bot-name>/.pi" \
  pnpm --dir "bots/<bot-name>" exec pi list
```

The installer downloads the package and its npm dependencies into the bot's `.pi/npm/` directory and updates its package settings. `--approve` trusts the selected project's local configuration for that invocation. Review any dependency-install-script warning and verify the affected dependency before approving scripts.

Use the same bot directory in both the environment variable and `--dir` argument. Preserve existing package entries and private auth/configuration files. Do not install globally unless the extension should load for every Pi project using that global agent directory.

## 3. Make the setup reproducible

For a standard Battuta extension, update its owning setup and release paths:

- Add the pinned package to `scripts/bot_setup/src/bot_setup/install.py`; include it in the owning role's installation list in `configure.py`.
- Add it to the owning role's generated bundle settings in `scripts/packaging/src/battuta_packaging/bundle.py`; install-runtime consumes the pinned package selection.
- Compile owned extension entry points and copy their resources through `scripts/packaging/build-bots.mjs`; keep external runtime dependencies in production manifests and frozen lockfiles.
- Add required runtime environment to source `scripts/bot_setup/run-dev.sh` and installed `scripts/packaging/src/battuta_packaging/launch.py`.

Keep runtime data out of source control. Extend tests in the owning `scripts/bot_setup/tests/` or `scripts/packaging/tests/` project for installation, retained settings, and launcher environment behavior. See [local setup](../.agents/skills/battuta-setup/references/development.md) for full bot configuration and launch instructions.

Memory is supplied by the shared [headless MCP service and thin Pi client](memory-service.md). CoS loads `memory-client/index.ts` for capture and isolated recall; its main session's memory MCP connection is disabled. Only the isolated recall agent receives CoS recall/get tools. Manager has a native direct MCP connection selected through `project-memory`; Workers receive selected context through Agent Mail. The retired Stone extension must not be loaded alongside it.
