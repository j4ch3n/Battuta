# Project Spec

Shared Pi extension for versioned project specifications, canonical checklists/reviews, and product decisions. PM authors immutable spec versions and go/no-go decisions; TL authors checklist/review replacements. Both roles inspect spec inventories and documents; the project CLI owns project discovery and workspace context.

- Full-content tools with role-specific registration and persistence checks.
- Serialized document/metadata writes with recovery and SHA-256 decision snapshots.
- Terminal decisions and guards against direct Pi write/edit of managed artifacts.

See [tool workflows](../shared-skills/project-context/references/spec-tools.md) and the [metadata contract](../shared-skills/project-context/references/spec-metadata.md).
