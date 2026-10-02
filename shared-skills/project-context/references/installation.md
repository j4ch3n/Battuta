# Installation

Install as the ordinary OS user running the bots. The tool runs independently of Battuta's checkout or the current working directory.

## Prerequisites

- uv and Python **3.12+** (`requires-python` is defined in `shared-skills/project-context-cli/pyproject.toml`). uv can provision Python with `uv python install 3.12`.
- Git and GitHub CLI (`gh`). Authenticate as the bot user with `gh auth login`, then verify `gh auth status`. Repository access uses that user's GitHub credentials.

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

For source development without a global tool installation, run `uv run --project shared-skills/project-context-cli --locked battuta-project <command>` from the Battuta root. The sibling CLI directory owns the source code, bundled templates, tests, Python environment, `pyproject.toml`, and `uv.lock`; its dependencies are separate from Battuta's root support-tooling environment. Skill instructions and references remain in `shared-skills/project-context/`. `pnpm check:support` runs the CLI's unit tests from `shared-skills/project-context-cli/tests/` in its own locked environment.

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

Include custom `gh`/Git locations in PATH when needed. Source/tmux launches inherit their shell environment; make the tool available before starting them. Verify `battuta-project --help` and `gh auth status` as the bot user with the intended PATH.

## Project registrations

Each registration stores its checkout in `~/.battuta/projects/<project>/code/`, with `project.yaml` and `MEMORY.md` alongside it. The configured `project.path` must be the absolute path to that checkout.

Use `battuta-project init <github-repo-url>` to create a registration and `battuta-project switch <project>` to select one. Initialization never overwrites an existing folder. Repository basenames must start with a letter or number and contain only letters, numbers, `.`, `_`, or `-`. Names match exactly, subject to the host filesystem's case sensitivity. See [command usage](commands.md) for the workflow.

Malformed configuration errors identify the file and field. Fix invalid data in place; a malformed `.config.json` is not silently overwritten. If selection points to a removed project, `switch` can select another existing project.
