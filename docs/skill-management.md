# Runtime skill management

## Catalog and selection metadata

`skills-hub/<name>/` owns each complete runtime skill: `SKILL.md`, references,
templates, scripts, assets, and required license notices. Contributor skills
stay in `.agents/skills/`; executable packages such as `project-context-cli/`
stay outside the catalog.

Each profile declares an ordered selection in `bots/<profile>/skills.json`:

```json
{ "skills": ["project-management", "note-taking"] }
```

These selections do not grant tools or permissions. Local source configuration
creates relative `.pi/skills/<name>` links into the catalog for Pi discovery;
all `.pi/skills/` output is ignored and must never be committed. Reconfiguring
reconciles only owned same-name hub links and refuses to overwrite custom
selected content. Empty selections are valid. Worker selections do not create
or launch workers.

Names must be unique lowercase kebab-case and match catalog directory and
frontmatter names. The shared validator rejects unknown fields, invalid
types/names, duplicates, unknown skills, traversal, escaping links, and missing
or non-regular entry points. There is no inheritance or dependency resolution.

## Validation and releases

The owning implementation is `scripts/bot_setup/`; packaging reuses it.

- `pnpm check:skills` checks all profile manifests against the shared catalog.
- `pnpm precommit` checks staged selections and entry points from the Git index;
  unstaged repairs cannot make invalid staged content pass.
- `battuta-packaging validate-skills ROOT` validates an assembled installation
  against its own `ROOT/skills-hub/`, without the source checkout or network.

Releases archive the catalog once, including nested resources and notices,
alongside the profile manifests. They contain no generated per-agent skill
discovery output. Installed Manager configuration validates selections and writes
selected shared catalog paths into Pi's native `skills` settings; it does not
copy the catalog into the profile. Worker configuration follows the same native
settings pattern. CoS continues to use its extension-managed runtime loadout.

Source setup validates selections before configuration writes and does not wipe
custom discovery content. When removing generated checkout links, inspect them first;
report unfamiliar local content rather than deleting it or following links
into the catalog.

## Maintaining skills

The Worker profile selects `artifacts` for commissioned creation and authorized
publication; Manager selects `artifact-review` for independent editorial judgment.
CoS retains final owner communication and intent/authority, not production tooling.

CoS and Manager select `project-management` for the project lifecycle and managed
document operations within their respective authority. Workers select
`execute-assignment` for commissioned project orientation and verified execution,
not project administration. Selections do not transfer document permissions.

- Add or edit complete skill sources in the hub, never generated bot output.
- Describe **when to use** a skill through the task or situation, never the
  identity of its invoker. Each `SKILL.md` states its objective, capabilities,
  boundaries, workflow, practical rationale, and a concise positive/negative
  example pair. Reuse an equivalent existing section rather than adding headings
  mechanically.
- Define roles only where they are recipients, authorities, subjects, or evidence
  sources. Loading a skill neither assigns that role nor grants its tools,
  permissions, or publication authority. Preserve literal routes such as
  `manager` and `cos` and state the real authorization prerequisite instead.
- Keep command detail, storage mechanics, and large templates in the skill's
  owned references. Link to the owning technical documentation rather than
  copying implementation details into workflow rationale.
- Rename directory, frontmatter, selections, owned links, callers, and maintained
  references together; do not keep duplicate instruction copies.
- Remove affected selections and callers before removing a source. Never
  discard custom content, private credentials, or session state.

Run manifest checks, affected support/Node checks, formatting, and local-link
validation. Test selection/validation and executable contracts, not prompt
wording. Installation guidance is indexed in
[release setup](../RELEASE.md#extension-and-skill-setup-index).
