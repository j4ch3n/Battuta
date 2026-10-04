# Project-spec metadata and files

Metadata lives at `<Specs Root>/index.json`. Each named document has one direct normalized directory:

```text
specs/
├── index.json
└── api-design/
    ├── spec-v1.md
    ├── spec-v2.md
    ├── checklist.md
    ├── review.md
    └── decision.md
```

Use `read_project_metadata` and `describe_spec` to inspect current metadata and artifact locations. The metadata schema version is `1`.

## Spec entries

- `name`, `directory`, and `file_base: "spec"` identify the display name and derived paths. Different names cannot share a normalized directory.
- `versions` contains consecutive identifiers such as `["v1", "v2"]`; `version_summaries` maps each identifier to the supplied short summary. Full version paths are derived, not duplicated in JSON.
- `checklist` is null or records `file: "checklist.md"`, summary, and exact-byte SHA-256. It is shared across all spec versions.
- `review` is null or records `file: "review.md"`, summary, review SHA-256, and the actual assessed `spec_version`/`checklist_sha256`. Only one current review file is retained.
- `decision` is null or records outcome `go`/`no-go`, latest `spec_version`, timestamp, `file: "decision.md"`, and exact-byte hashes for spec/checklist/decision/review. Absent optional checklist/review files have null hashes.

## Read results

`read_project_metadata` returns the existing registration plus the spec entries. Missing index metadata is an empty inventory; reading it does not create a registry or spec scaffold.

`describe_spec` returns presence, paths, fingerprints, and `review_status: missing | current | stale` from one locked snapshot. With `include_content: true`, it also returns complete document text paired with those fingerprints. Latest-version review coverage is current only when its assessed version, checklist fingerprint, and review bytes match. This is informational and never a finalization gate.

Saved specs are immutable. Before finalization, TL can fully replace checklist/review; after finalization, every artifact is locked. Product decision metadata is not a claim that engineering verification or product acceptance passed.
