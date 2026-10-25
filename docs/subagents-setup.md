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

## Verification and remaining acceptance

One-time offline verification on 2026-10-25 loaded the actual
`pi-subagents@0.82.1` package through Pi 1.3.0's normal package registration.
Both foreground and detached background scouts passed: every local-provider
request used the saved fixture Pi credential, and the selected fixture web
extension's `web_search` tool ran and returned its result. Tool lists excluded
the ambient sentinel and Linear/memory/todo/MCP tools; load markers showed the
selected extension loaded in the child and the ambient extension loaded only
in the parent.

After this successful proof, the upstream-feature integration test was
deliberately removed, along with unused TL test/typecheck/coverage tooling.
There is no ongoing Battuta integration suite for upstream plugin features.
Battuta's Python setup/release contract tests remain and cover repeat runs,
native configuration, private-file preservation, and release configuration.
Background execution needs the supported installed Pi host, not just an SDK
imported from an unrelated path.

The one-time proof establishes fixture auth-store reuse and extension selection,
not live Codex OAuth/subscription access, OAuth refresh, live web search, or
Telegram acceptance. No live credentials were used.
For deployment acceptance, use a disposable workspace and TL's existing login:

1. Launch a scout through TL and verify its provider/model and attributable result.
2. Ask it to search; verify web-access tools work and other integrations are absent.
3. Repeat in background and inspect the native run's terminal result.
4. Record deployment version, child IDs, tested conditions, and limitations without
   credentials or raw authentication logs. Lifecycle behavior is upstream-owned;
   do not assume the removed wrapper's process or snapshot guarantees still apply.
