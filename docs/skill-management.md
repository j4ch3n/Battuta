# Runtime skill management

## Ownership and naming

`skills-hub/<name>/` is the source of each runtime skill. Keep its complete
directory: `SKILL.md`, references, templates, scripts, assets, and required
license notices. Bot `.pi/skills/` directories are discovery output, not
independent instruction sources. Contributor skills stay in `.agents/skills/`;
executable CLI packages stay outside the hub, with the project CLI in
`project-context-cli/`.

Use lowercase kebab-case matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Catalog directory,
manifest selection, and `SKILL.md` frontmatter `name` must match. Names are
unique across the catalog. The single `memory` skill contains PM read/write
and TL read-only guidance; selection does not grant tool permissions.

## Manifest contract

Each profile has a `bots/<profile>/skills.json` file:

```json
{ "skills": ["memory", "project-context", "note-taking"] }
```

The only field is `skills`, an ordered array of unique catalog names. Empty
arrays are valid. Reject unknown fields, non-string/invalid names, duplicates,
unknown skills, traversal/absolute paths, escaping catalog links, and missing
or non-regular `SKILL.md` entry points. The manifest selects instructions, not
security permissions, dependencies, models, or tool configuration. There is
no inheritance or automatic dependency resolution.

PM and TL manifests retain their respective skill sets. Their directories
remain named PM/TL until the identity migration. All future worker instances
consume the single `bots/worker/skills.json` profile; it does not create or
launch workers.

`bot-setup/skills.mjs` maintains the shared validation implementation:

- `pnpm check:skills` validates all profile manifests against the checkout hub.
- `node bot-setup/skills.mjs <skills.json> <skills-hub>` prints validated names
  as JSON for source setup; Node release staging imports the same validator.
- `pnpm precommit` validates staged manifests and selected entry points from
  the Git index before formatting/linting staged files. Unstaged repairs do
  not make an invalid staged selection valid. Failures block the commit.
- The release build validates all profiles before assembly, then validates
  the staged selections before creating runtime skill output.

Validation exits nonzero with the affected manifest/entry point on failure.
Correct the source or manifest and rerun the command; do not continue setup
or bypass the gate with invalid selections. Validation makes no model calls
and does not message bots.

## Source setup and release behavior

Source setup validates the complete selection before changing skills, then
creates individual relative `.pi/skills/<name>` links into the hub. Custom
workspaces use their own manifest when present, otherwise the owning role's
manifest. Setup preserves custom directories, refuses conflicting files or
unrelated links, and recognizes known legacy links for migration. The
`.pi/skills/` directory itself must be a local directory, not a catalog link.
Repeating setup is idempotent. After validating the entire selection and
checking selected-entry conflicts, setup removes deselected links whose
relative targets exactly match the same-name hub path or a recognized legacy
path, including broken links. These target patterns identify setup ownership;
there is no separate ownership registry. Empty selections remove all such
links. Custom directories, files, absolute links, and unrelated links remain
untouched when deselected. Preflight failures leave skill output unchanged.

Release staging reads the same manifests, copies selected formerly bot-local
skills completely, and links selected shared skills to the bundled hub.
Installed configuration preserves local skill content. FIS-132 owns fresh
hub-free bundles, exact selection enforcement, and upgrade-state handling;
current releases intentionally retain the hub. Setup/installation navigation
is maintained in the [release setup index](../RELEASE.md#extension-and-skill-setup-index).

## Changing skills

- **Add:** create the complete hub directory and valid entry point; select it
  in the consuming profiles and update the release setup index if needed.
- **Change:** edit the owning hub files, not discovery links or bundled copies.
  Preserve resources, notices, and role authority unless behavior changes are
  separately authorized.
- **Rename:** update the directory, frontmatter name, manifests, discovery
  links, callers, tests, and active documentation together.
- **Remove:** remove affected selections and callers, rerun source setup to
  reconcile owned links, then remove the source. Custom entries require
  explicit handling; release upgrade-state handling belongs to FIS-132.
  Never discard custom content or private auth/session state.

Run `pnpm check:skills`, `pnpm check:support`, affected Node tests, formatting,
and lint checks. Check local documentation links and complete nested resources.
Tests should exercise discovery, validation, selection, preservation,
idempotence, failures, and release relocation—not instruction wording.
