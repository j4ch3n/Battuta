# Project Spec

Shared Pi extension for versioned project specifications, canonical checklists/reviews, and product decisions. CoS authors immutable spec versions and go/no-go decisions; Manager authors checklist/review replacements. Both roles inspect spec inventories and documents; the project CLI owns project discovery and workspace context.

- Full-content tools, including dedicated constitution reads and versioned authoring, with role-specific registration and persistence checks.
- Serialized document/metadata writes with recovery and SHA-256 decision snapshots.
- Terminal decisions and guards against direct Pi write/edit of managed artifacts.

See [tool workflows](../skills-hub/project-management/references/spec-tools.md) and the [metadata contract](../skills-hub/project-management/references/spec-metadata.md).
