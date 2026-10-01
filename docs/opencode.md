# OpenCode contributor setup

Battuta keeps its high-level contributor instructions and project map in root `AGENTS.md`, and on-demand project workflows in `.agents/skills/`:

- `battuta-setup`: development dependencies, configuration, and source launch.
- `battuta-verify`: check selection, focused tests, coverage review, and completion evidence.

OpenCode discovers these skills natively. Load the relevant skill when its description matches the task; keep detailed workflows out of the always-loaded `AGENTS.md`.

Each skill keeps its dedicated guides in a local `references/` folder. References used by multiple skills, such as the stack, command, and OpenCode guides, live in `docs/` alongside standalone technical material.

## Superpowers

The root `opencode.json` configures [Superpowers](https://github.com/obra/superpowers), pinned to `v6.4.2`, using its official git-backed plugin installation. OpenCode installs the plugin and registers its engineering workflow skills when the project loads; no vendored checkout or manual skill symlinks are needed.

The checked-in configuration uses OpenCode V1's `plugin` key. For OpenCode V2 (2.0.4 or later), change that key to `plugins` as described in the [upstream installation guide](https://github.com/obra/superpowers/blob/main/.opencode/INSTALL.md).

From the repository root on V1, verify discovery with:

```sh
opencode debug skill
```

Confirm the two Battuta skills and Superpowers skills such as `brainstorming`, `systematic-debugging`, and `test-driven-development` appear. Quit and restart OpenCode after changing configuration or skills; an existing session retains its loaded configuration.

To update Superpowers, select a reviewed upstream tag, update the plugin spec in `opencode.json`, restart, and verify discovery again. See upstream installation guidance for cache troubleshooting.
