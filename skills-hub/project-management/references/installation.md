# Installation

Install as the ordinary OS user running the bots. The tool runs independently of Battuta's checkout or the current working directory.

## Prerequisites

- uv and Python **3.12+** (`requires-python` is defined in `project-context-cli/pyproject.toml`). uv can provision Python with `uv python install 3.12`.
- Git and GitHub CLI (`gh`) for `init --github`; name-only initialization and metadata linking do not require them. Authenticate as the bot user with `gh auth login`, then verify `gh auth status` before cloning. Repository access uses that user's GitHub credentials.
- A Linear personal API token in the session's `LINEAR_API_TOKEN` environment variable (reuse the value used for Linear MCP). Every `battuta-project` command, including help, requires it. Startup checks presence only; `explain` needs read access to a linked project and `linear create` needs project-creation access.

See the official [uv installation guide](https://docs.astral.sh/uv/getting-started/installation/) and [GitHub CLI installation guide](https://cli.github.com/).

## Source checkout

From the Battuta repository root:

```sh
uv tool install --python 3.12 ./project-context-cli
uv tool update-shell
battuta-project --help
```

Open a new shell after `update-shell` if necessary. For an update, reinstall from the updated checkout:

```sh
uv tool install --reinstall --python 3.12 ./project-context-cli
```

For source development without a global tool installation, run `uv run --project project-context-cli --locked battuta-project <command>` from the Battuta root. Run `pnpm check:support` to verify the CLI and support tooling.

## Released archive

The bot archive does not contain the Python CLI or dependency wheels. Install the
selected GitHub Release's `battuta_project-<version>-py3-none-any.whl` with
`uv tool install`; the version includes the tag and short commit SHA. Release
setup provides the exact download URLs, SHA256 checks, and dependency constraints.
For a wheel already downloaded and verified with its constraints:

```sh
uv tool install --python 3.12 --no-build \
  --constraint battuta-project-constraints.txt ./battuta_project-<version>-py3-none-any.whl
uv tool update-shell
battuta-project --help
```

Replace `<version>` before running the command. Use `--reinstall` for an updated
release. Online installation resolves third-party packages from PyPI; Battuta's
wheel is a separate GitHub asset. Production verification targets Linux ARM64,
Python 3.12. Installing from source remains a separate development workflow.

## Bot service PATH

`uv tool dir --bin` prints the executable directory (normally `~/.local/bin`). Interactive shell initialization does not automatically apply to systemd user services.

Newly generated release units already include the uv tool directory and uv's
executable directory on PATH. Check any retained overrides. For custom or older
bot units (`battuta-cos.service`, `battuta-manager.service`, and
`battuta-worker.service`), use `systemctl --user edit <service>` and set an explicit
PATH, replacing the example home with the actual absolute tool directory:

```ini
[Service]
Environment="PATH=/home/bot/.local/bin:/usr/local/bin:/usr/bin:/bin"
```

Then reload the unit definitions without starting services:

```sh
systemctl --user daemon-reload
```

During release setup, keep bots stopped and return to the release guide's startup
step. For an already running deployment, ask the owner before restarting affected
bots to pick up PATH changes; a worker restart can claim available work.

Include custom `gh`/Git locations in PATH when needed (Homebrew on Apple Silicon commonly uses `/opt/homebrew/bin`). Source/tmux launches inherit their shell environment; make the tool available before starting them. Ensure bot services also receive `LINEAR_API_TOKEN` through their runtime environment. Verify `battuta-project --help` and, when cloning is needed, `gh auth status` as the bot user with each bot's intended PATH and token environment. Notes use ordinary Pi file tools; this CLI does not manage notebooks or TODO progress.

## Project registrations

All projects live under `~/.battuta/projects`, inside the global Battuta directory. There is no project-root option or environment override. See the [project configuration contract](../../../docs/project-context.md) for the minimal `project.yaml` shape and filesystem identity.

Before upgrading an existing installation, stop affected bots. Move any custom-root project directories into `~/.battuta/projects` without changing their names. Remove the duplicated `project` name/path section from each `project.yaml`, retaining its version and GitHub/Linear associations. Remove obsolete project-root overrides from launch configuration. The CLI does not convert YAML, move private files, or delete an old root `.config.json`; that selection file is ignored. Other components' `.config.json` metadata must be retained. A directory rename changes project identity and does not rewrite assignment or memory references.

With the intended bot user's HOME/PATH/token environment, run `battuta-project list --json`. Stop if it fails; success returns the complete project-name array (empty for no registrations). Run `battuta-project explain <project-name>` to inspect an intended project's paths and guidance. See [command usage](commands.md) for initialization, GitHub/Linear association, and memory workflows.
