# Artifact commands

Run `battuta-artifact` from any directory. Flags are the input contract; there is no JSON/manifest input. `--json` works before or after management subcommands. Use the artifacts skill for template selection and ownership decisions.

## Initialize and publish

```sh
battuta-artifact init sizing --project procurement --title "VRAM sizing" \
  --description "Sizing assumptions and evidence" --slug procurement-sizing --json
```

`init NAME` requires `--project`, `--title` and `--description`. `--slug` defaults to NAME; `--template` chooses a packaged reference. Names/slugs use lowercase letters/digits separated by single hyphens. Titles/descriptions must be nonblank. Unknown projects, duplicate identities and existing destinations fail without overwriting work. The local registry must be initialized, but no server, public base URL, selection, network or Linear access is needed.

Success returns `artifact` (identity, `status: draft`, template, revision and runtime allowlist), `directory` (actual absolute location), `guidance` and `files` (relative path, purpose and initial sharing flag). Human output combines guidance with the annotated tree. Edit freely using ordinary file tools at the returned directory. The packaged descriptor is not copied. Drafts have no delivery URLs and cannot be accessed through the public catalog or file routes.

```sh
battuta-artifact publish --project procurement --artifact sizing \
  --expected-revision 1 --json
```

`publish` uses the existing project's artifact name, not its optional public slug. It validates all current runtime mappings and atomically publishes that same record. Repeat `--file relative/path` for explicit additional assets. It never recopies the template or resets content. Missing files fail without publication. An unchanged repeated publication does not increment revision; stale expected revisions still conflict.

Published results include `artifact.url`, `artifact.local_url`, status and revision. A configured public base URL is required before publication, not proof of delivery. Check the local URL for the host service; do not fetch the public URL as a setup/publication check or assume external accessibility from a successful local response.

## Serve existing Markdown immediately

```sh
battuta-artifact add-file --type markdown --file /absolute/research.md \
  --slug research --title "Research" --description "Existing research notes" --json
```

Requires an existing absolute regular `.md`/`.markdown` UTF-8 file, slug, title and description. This immediately creates a **published** single-file record pointing to the original. It does not initialize a bundle, wrap/copy/move the file or require a later publish. Adjacent files are not shared. Use only for the intended sharing scope, not private preview. Raw HTML is disabled in the Markdown viewer.

## Inspect, update and replace files

```sh
battuta-artifact list --json
battuta-artifact show procurement-sizing --json
battuta-artifact update procurement-sizing --description "Revised evidence" --expected-revision 2 --json
battuta-artifact replace-files procurement-sizing --root "<returned-directory>" \
  --entry index.html --file styles.css --file custom.js --expected-revision 3 --json
```

These commands use the **public slug**. Local inspection includes drafts. `update` changes supplied metadata only. `replace-files` replaces the complete file configuration, including unchanged desired assets; omitted files lose HTTP access. Project presentations retain their managed directory and `index.html` entry, but no original template asset is mandatory. No file operation changes draft/publication status.

With `--root`, entry/assets are exact relative files; the entry is included automatically. Without `--root`, provide an absolute `--entry` and no additional files. Entry extensions are `.html`, `.htm`, `.md` or `.markdown`; paths reject traversal, symlinks, directories and globs. Original-file edits need no command and are live once published. Metadata/file replacement increments revision; use `show`'s revision for guarded changes and inspect again on conflict.

## Withdraw and recover

```sh
battuta-artifact deregister procurement-sizing --expected-revision 4 --json
```

Removes the record and mappings; subsequent requests return 404 and the index refreshes. Originals remain unchanged; in-flight streams and existing downloads cannot be recalled.

JSON success has `ok: true`; failure has `ok: false` and `error.code`/`error.message`. Exit codes: `0` success, `2` invalid input, `3` missing artifact, `4` conflict, `5` storage/access/schema failure. On unavailable schema or sources report the blocker; never edit SQLite, relocate files, change services or delete existing work as a workaround.
