# Installation

Install as the ordinary OS user running the bots. The tool runs independently of Battuta's checkout or the current working directory.

## Prerequisites

- uv and Python **3.12+** (`requires-python` is defined in `shared-skills/project-context-cli/pyproject.toml`). uv can provision Python with `uv python install 3.12`.
- Git and GitHub CLI (`gh`). Authenticate as the bot user with `gh auth login`, then verify `gh auth status`. Repository access uses that user's GitHub credentials.
- A Linear personal API token in the session's `LINEAR_API_TOKEN` environment variable (reuse the value used for Linear MCP). Every `battuta-project` command, including help, requires it. Startup checks presence only; `linear refresh` needs read access to teams, `explain` needs read access to a linked project, and `linear create` needs project-creation access.

See the official [uv installation guide](https://docs.astral.sh/uv/getting-started/installation/) and [GitHub CLI installation guide](https://cli.github.com/).

## Source checkout

From the Battuta repository root:

```sh
uv tool install --python 3.12 ./shared-skills/project-context-cli
uv tool update-shell
battuta-project --help
```

Open a new shell after `update-shell` if necessary. For an update, reinstall from the updated checkout:

```sh
uv tool install --reinstall --python 3.12 ./shared-skills/project-context-cli
```

For source development without a global tool installation, run `uv run --project shared-skills/project-context-cli --locked battuta-project <command>` from the Battuta root. Run `pnpm check:support` to verify the CLI and support tooling.

## Released archive

The release includes a built tool and locked dependency wheels. From the extracted Battuta root, install without downloading Python packages:

```sh
uv tool install --python 3.12 --no-index \
  --find-links ./shared-skills/project-context-cli/wheels battuta-project
uv tool update-shell
battuta-project --help
```

Use `--reinstall` for an updated release. Python 3.12 must already be available for a fully offline installation. Release wheels target the release platform: Linux ARM64, Python 3.12. Installing from source resolves dependencies for the host's platform and supported Python version instead.

## Bot service PATH

`uv tool dir --bin` prints the executable directory (normally `~/.local/bin`). Interactive shell initialization does not automatically apply to systemd user services.

For each service, use `systemctl --user edit battuta-pm.service` or `battuta-tl.service` and set an explicit PATH, replacing the example home with the actual absolute tool directory:

```ini
[Service]
Environment="PATH=/home/bot/.local/bin:/usr/local/bin:/usr/bin:/bin"
```

Then reload and restart the affected services:

```sh
systemctl --user daemon-reload
systemctl --user restart battuta-pm.service battuta-tl.service
```

Include custom `gh`/Git locations in PATH when needed. Source/tmux launches inherit their shell environment; make the tool available before starting them. Ensure bot services also receive `LINEAR_API_TOKEN` through their runtime environment. Verify `battuta-project --help` and `gh auth status` as the bot user with the intended PATH and token environment.

## Project registrations

Use `battuta-project init <github-repo-url>` to register a repository and `battuta-project switch <project>` to select an existing project. Run `battuta-project explain` to find its checkout and repository guidance. Initialization preserves existing registrations. See [command usage](commands.md) for project, Linear, and memory workflows.
