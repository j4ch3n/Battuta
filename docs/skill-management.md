# Runtime skill management

## Catalog and selection metadata

`skills-hub/<name>/` owns each complete runtime skill: `SKILL.md`, references,
templates, scripts, assets, and required license notices. Contributor skills
stay in `.agents/skills/`; executable packages such as `project-context-cli/`
stay outside the catalog.

Each profile declares an ordered selection in `bots/<profile>/skills.json`:

```json
{ "skills": ["memory", "project-context", "note-taking"] }
```

These selections are **metadata only**. Setup and release assembly do not
copy skills, create symlinks, configure skill paths, or bind them to Pi.
Selection does not grant tools, permissions, or runtime discovery. Empty
selections are valid. Worker selections do not create or launch workers.

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
discovery output. Installed configuration validates metadata, not a fixed
per-agent bundle. Runtime skill loading is intentionally not configured yet.

Setup validates before configuration writes and does not wipe discovery
directories. When removing generated checkout links, inspect them first;
report unfamiliar local content rather than deleting it or following links
into the catalog.

## Maintaining skills

- Add or edit complete skill sources in the hub, never generated bot output.
- Rename directory, frontmatter, selections, owned links, callers, and maintained
  references together; do not keep duplicate instruction copies.
- Remove affected selections and callers before removing a source. Never
  discard custom content, private credentials, or session state.

Run manifest checks, affected support/Node checks, formatting, and local-link
validation. Test selection/validation and executable contracts, not prompt
wording. Installation guidance is indexed in
[release setup](../RELEASE.md#extension-and-skill-setup-index).
