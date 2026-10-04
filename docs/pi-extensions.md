# Installing Pi extensions

Battuta keeps Pi packages and runtime state local to each bot. Install from the selected bot's directory with `PI_CODING_AGENT_DIR` pointing to its `.pi` directory; `pi install -l` registers the package in that bot's `.pi/settings.json`.

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

- Add the pinned package to `scripts/bot_setup/install.py` and export it from `scripts/bot_setup/__init__.py`; include it in `bots/<bot-name>/scripts/configure-bot.py`'s installation list.
- Bundle it for the same bot in `.github/workflows/release.yml`.
- Update `packaging/configure.mjs` so retained release settings discover the bundled package without duplicating existing entries or replacing package resource selections.
- Add required runtime environment to the source launcher `bots/pm-bot/scripts/run-dev.sh` and the release foreground/service launcher `packaging/battuta`.

Keep runtime data out of source control. Extend the relevant tests in `scripts/tests/` for installation, retained-settings migration, and launcher environment behavior. See [local setup](../.agents/skills/battuta-setup/references/development.md) for full bot configuration and launch instructions.
