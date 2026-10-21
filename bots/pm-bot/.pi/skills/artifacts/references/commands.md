# Artifact commands

Run `battuta-artifact` from any directory. Parameters are the input contract; there is no JSON/manifest input. `--json` selects machine-readable output and works before or after management subcommands.

## Register

Single file:

```sh
battuta-artifact register --slug proposal --title "Proposal" \
  --description "Product proposal" --entry /home/pi/project/proposal.html --json
```

Bundle:

```sh
battuta-artifact register --slug demo --title "Product demo" \
  --description "Interactive walkthrough" --root /home/pi/demo/dist \
  --entry index.html --file css/main.css --file js/app.js --json
```

The entry is included automatically; repeat `--file` for each additional file. With `--root`, all file paths are relative to that directory. Without it, provide an absolute entry and no additional files. Slugs use lowercase letters/digits separated by single hyphens; title and description are required. Entries support `.html`, `.htm`, `.md`, and `.markdown` by extension, without content validation. Assets are exact files, not directories or globs. Symlinks and traversal are rejected.

Registration exposes only the listed files and returns `artifact.url`, `artifact.revision`, metadata, root, and file mappings. Duplicate slugs fail rather than overwrite.

## Inspect and change

```sh
battuta-artifact list --json
battuta-artifact show demo --json
battuta-artifact update demo --description "Revised walkthrough" --expected-revision 1 --json
battuta-artifact replace-files demo --root /home/pi/demo/dist --entry index.html \
  --file css/main.css --file js/app-v2.js --expected-revision 2 --json
```

`update` changes supplied title/description only. `replace-files` atomically replaces the root, entry, and complete allowlist; omitted files lose access. Original content edits require no command. Both increment the revision. `--expected-revision` is optional, but use the revision from `show` for guarded mutations. A conflict means reread before deciding what to change.

## Deregister

```sh
battuta-artifact deregister demo --expected-revision 3 --json
```

Removes registration and file mappings. Subsequent requests return 404, and the index refreshes automatically. Original files remain unchanged. Existing streams/downloads cannot be recalled.

## Results and recovery

JSON output has `ok: true` on success. Failures have `ok: false` and `error.code`/`error.message`. Exit codes: `0` success, `2` invalid input, `3` missing artifact, `4` conflict, `5` storage/access/schema failure. Do not treat an error as publication success or edit the database directly. Missing schema requires operator setup; unavailable sources require correcting the file selection/location.
