# Project-spec metadata contract

Spec tools own metadata and document storage. Use `inspect_specs` for a project's inventory and `describe_spec` for resolved artifact locations and content; do not derive locations from a presumed layout. The metadata schema version is `1`.

## Spec entries

- `name`, `directory`, and `file_base: "spec"` identify the display name and derived paths. Different names cannot share a normalized directory.
- `versions` contains consecutive identifiers such as `["v1", "v2"]`; `version_summaries` maps each identifier to the supplied short summary. Full version paths are derived, not duplicated in JSON.
- `checklist` is null or records `file: "checklist.md"`, summary, and exact-byte SHA-256. It is shared across all spec versions.
- `review` is null or records `file: "review.md"`, summary, review SHA-256, and the actual assessed `spec_version`/`checklist_sha256`. Only one current review file is retained.
- `decision` is null or records outcome `go`/`no-go`, latest `spec_version`, timestamp, `file: "decision.md"`, and exact-byte hashes for spec/checklist/decision/review. Absent optional checklist/review files have null hashes.

## Read results

`inspect_specs(project)` returns only `{ "schema_version": 1, "specs": [...] }`, without project registration, paths, checkout, or configuration. Missing index metadata is an empty inventory; reading it does not create storage. Version summaries and decisions are metadata, not proof of delivery.

`describe_spec` returns presence, paths, fingerprints, and `review_status: missing | current | stale` from one locked snapshot. With `include_content: true`, it also returns complete document text paired with those fingerprints. Latest-version review coverage is current only when its assessed version, checklist fingerprint, and review bytes match. This is informational and never a finalization gate.

Saved specs are immutable. Before finalization, TL can fully replace checklist/review; after finalization, every artifact is locked. Product decision metadata is not a claim that engineering verification or product acceptance passed.
