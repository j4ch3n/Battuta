# Project configuration and identity

The global Battuta directory is `~/.battuta/`. Projects use only its `projects/`
child; there is no configurable project root or global current-project file.

```text
~/.battuta/projects/
  atlas/
    project.yaml
    SUMMARY.md
    code/
```

A regular `project.yaml` in an immediate, nonhidden, nonsymlink directory marks a
registered project. The directory name is the exact project identity; its managed
root is that directory and its checkout is always `code/`. YAML does not duplicate
the project name or checkout path.

```yaml
version: 1
github:
  repository: owner/atlas
linear:
  project_id: your-linear-project-id
  team_id: your-linear-team-id
```

Associations are optional; omitted GitHub/Linear sections default to null values.
Unknown configuration fields and unsupported versions are rejected. CLI discovery
validates registered configurations and checkouts before returning a catalog;
broken projects cause an error, not a partial successful list. Spec tools require
a safe registration marker but remain independent of association contents and
checkout health.

Each project operation names its target explicitly. Initialization does not select
a project. Commands for different projects can run concurrently; association
updates to the same project should be serialized. Missing/unknown targets never
fall back to another conversation or the working directory. Project configuration
uses atomic file replacement; it is not a concurrent-edit merge system.

Assignments/TODOs remain in Supabase, memories in the memory service, and managed
documents in their existing stores. Their project labels are references to
filesystem identity, not duplicate project registration catalogs. Renaming a
directory changes that identity and does not rename those references.

Existing installations must adopt this YAML shape and fixed location before use.
There is no automatic conversion, relocation, or private-file deletion. The old
root `.config.json` is ignored; nested document metadata files remain in use.
