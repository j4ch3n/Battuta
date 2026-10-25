# TL subagent setup

TL uses the native MIT `pi-subagents@0.82.1` package with Pi 1.3.0. PM does not
install it. There is no Battuta child runtime or separate child credential.

## Source setup

Run the normal TL configuration from the repository root:

```sh
uv run --locked python bots/tl-bot/scripts/configure-bot.py
```

For a custom workspace, add `--bot-dir /absolute/path/to/tl-workspace`. Setup
registers and installs the pinned package and `pi-web-access@0.43.0`, then uses
Pi's own settings and the package's bundled agents/skill. Restart TL afterward.

Release configuration uses the same setup-only helper; release assembly installs
the packages. Existing authentication and other private files are not copied or
overwritten. Old `.pi/subagents.json` grants are unused and left untouched.
Remove an old deployed `bounded-subagents` extension directory and copied
`use-subagent` skill before restarting an installation that retained those files;
the repository no longer ships them. Setup removes explicit registrations of
the obsolete adapter but does not delete operator files.

## Authentication

Children use the normal Pi agent directory and authentication store, selected
provider/model, home, environment, and requested working directory. Log in once
in TL's Pi environment, including for an `openai-codex` subscription. Do not create
a child API key or copy `auth.json`. Native Pi handles authentication and refresh.

For headless/Telegram TL, use the same `PI_CODING_AGENT_DIR` when performing the
initial interactive Pi login. A login under a different home or agent directory
is not automatically available to TL or its children.

## Child extension selection

Setup writes upstream `subagents` settings inside TL's `.pi/settings.json`:

- `defaultExtensions` names only the absolute path to the installed web-access
  package's `dist` directory. An explicit list disables ambient extension loading
  for both foreground and background children.
- Native role overrides include the web tools in their tool allowlists. Scouts,
  reviewers, researchers, evidence auditors, and oracles get read/search tools;
  workers and delegates also get shell/edit/write tools.
- Skills, project/global instructions, and forked conversation are excluded by
  default through native role settings. No additional context-switch interface
  is added by Battuta.

Telegram, Agent Mail, Linear/MCP, memory, notes, and todo extensions are not
inherited. Upstream's internal child coordination hooks are not parent plugins.
The package provides its own tool help and parent-only orchestration skill;
use its native `subagent` tool rather than `bounded_subagents`.

Existing native customization is preserved. This is an upstream **default**, not
an immutable security policy: role/project settings, explicit skill requests,
custom agent definitions, and host-required extensions can change the effective
configuration. Review them if the exact allowlist matters. Setting
`defaultExtensions: []` disables ambient plugins entirely; remove web tools from
the relevant role allowlists too, or upstream will correctly report missing tools.

Children are trusted workers, not a sandbox. Workers edit the real workspace and
can run commands with the same user's file/environment access. TL still reviews
changes and verification evidence; child output is not product acceptance.
