# FIS-116: bounded TL children

## Research and decision

Use MIT `pi-subagents` **0.81.0**, with Battuta's Pi **1.3.0**. Its published
delegation event API already supplies attributable terminal results, usage,
provider diagnostics, cancellation and deadlines. The bundled Pi subagent example
is smaller but would require reimplementing these contracts. Package metadata alone
is not compatibility evidence: exercise the installed package and Pi in headless
tests. Retain the upstream license through the installed dependency.

Reviewed sources: [published 0.81.0 package](https://registry.npmjs.org/pi-subagents/0.81.0),
its `src/api/delegation`, `src/runs/shared/child-session`,
`src/runs/shared/child-tool-plan`, `src/agents/frontmatter` and agent configuration
reference; compared the [bundled Pi subprocess example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent).
The npm tarball SHA-1 was `06202f567a8c82e42e34c3462274694d633c8510`;
the committed pnpm lock retains the stronger registry integrity digest.

Source review found an important asymmetry: upstream foreground children do not
load ambient extensions, but detached background children do unless explicitly
disabled. Both use the operator's agent directory by default. A tool allowlist is
not a filesystem sandbox; built-in read can access credentials and bash can mutate
anything. Installing the upstream extension directly in TL is therefore rejected.

## Architecture

TL exposes one small launch/status/cancel facade. Each launch uses a short-lived
credential-minimized Node process running upstream's public delegation API. This
is not a daemon. Both TL foreground and background calls use upstream **foreground**
delegation in that owned process; there is no upstream detached fleet. A bounded
in-memory job table gives the Telegram/headless parent inspection and cancellation.
Parent shutdown terminates all owned process groups. Results are evidence, never
automatic acceptance, merge, document publication or release.

Operator configuration is opt-in and authorizes exact input files from one source
root, writable paths, model/provider and limits. Each task receives a new private
snapshot of only those files, with no symlinks, hidden paths or runtime credentials.
Workers edit only authorized paths in that snapshot, never the source tree.
Each task narrows the operator's exact input/write lists; task prose cannot grant
filesystem authority. The child's own tool-call gate blocks upstream's internally
added `contact_supervisor` tool as well as any unselected capability.
Scout/reviewer have no mutating tools. All profiles receive only selected scoped
file tools; no shell, MCP, memory, canonical-doc tools, owner messaging, ambient
extensions, skills or inherited context. Nested delegation is disabled. Research
is local-source inspection only in this first version; network research stays with
TL rather than inheriting unrestricted research adapters.

Children receive only an explicitly selected provider API key, not the parent's
auth file or environment. Private HOME/agent directories prevent ambient discovery.
An operator-selected OpenAI-compatible endpoint supports dedicated child credentials
and safe local-provider tests; it must not contain a credential in its URL.

Defaults: concurrency 2, total session spawns 12, timeout 120 seconds. Configuration
cannot exceed concurrency 4, spawns 32 or timeout 600 seconds. No queuing: capacity
rejections are explicit and parallel batch admission is atomic. Outputs and files
have bounded sizes. Completed workspaces remain for TL inspection until parent
shutdown; no automatic application back to the source.

## Verification and limitations

Test actual upstream/Pi startup and delegation against a local fake provider, not
an upstream mock, including tool boundaries and failures. Test facade status,
cancel, deadline and shutdown without UI. No production Telegram tokens, provider
credentials, bots or private settings may be touched. A live deployed Telegram
demonstration therefore remains an explicit operator acceptance step; safe headless
evidence must not be described as that demonstration.
