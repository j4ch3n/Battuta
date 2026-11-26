# Memory operations

Battuta's long-term memory is one [agent-memory](https://github.com/tigerless-labs/agent-memory)
store served by `battuta-memory`. The store is a folder of markdown files and a
rebuildable index. The memory client in CoS only reads it and triggers the dream;
all model work happens in the dream, which runs Claude Code.

## Storage

Under `BATTUTA_MEMORY_DATA_DIR` (default `~/.battuta/memory/`):

| Path                                          | Contents                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `store/<type>/*.md`                           | One memory per file: front matter (fields, links, weight, timestamps) and a body |
| `store/MEMORY.md`                             | The library's index of current memories                                          |
| `store/archive/sessions/cos-YYYY-MM-DD.jsonl` | Append-only Owner ↔ CoS conversation, one file per local day                     |
| `store/schemas/*.toml`                        | The eleven memory types; copied from the package on first start                  |
| `store/.index/`                               | Search index (BM25 and vectors); rebuildable from the files                      |
| `store/.state/`                               | Locks, distill watermarks, `battuta-catalog.json`, `battuta-dream.json`          |
| `dream.log`                                   | Output of the last dream worker runs                                             |

Every memory carries `fields.project`: a project name from `battuta-project list`
(as its file-name segment) or `global` for the owner's personal memories. The
server rejects writes to unknown projects and every overview write outside the
overview step. Back up the whole data directory with the server stopped; the
index can be deleted and is rebuilt from the files.

## Recall

Hybrid search: BM25 with the `cjk` tokenizer (English and Chinese), plus local
Qwen3-Embedding-0.6B vectors, combined with memory weight and recency decay.
`memory_recall` maps its inputs:

| Input                | Result                                            |
| -------------------- | ------------------------------------------------- |
| `projects` only      | Each project's current overview                   |
| `projects` + `query` | Search within those projects (overviews excluded) |
| `query` only         | Search all projects                               |
| `types`              | Narrows any of the above                          |

Unknown projects or types return `status: invalid` with the valid lists. CoS
recalls once before each reply to an owner message, with an unscoped query built
from that message, and injects only the newest result as context. The owner card
(global overview plus one line per project) is injected at session start and after
compaction.

## Nightly dream

The scheduler asks CoS to call `memory_dream` at 05:30. The tool:

1. reads `memory_dream_status` and computes the window: from local midnight of the
   last successful dream, or 14 days back on the first run;
2. extracts owner and CoS text messages from CoS's session files in that window
   (tool output and injected memory are skipped) and uploads them to `POST /archive`;
   the server dedupes by entry id;
3. calls `memory_dream_start` and polls `memory_dream_status` until the worker ends.

The worker (`battuta-memory dream run`, a detached process) runs four steps,
recorded in `battuta-dream.json` as `step`:

| Step          | Work                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `catalog`     | Refresh the project catalog from `battuta-project list --json`                                                             |
| `distill`     | For each archive day past its watermark, Claude Code proposes memories; the store validates and writes them                |
| `consolidate` | The library's review merges, supersedes, or reweights memories; overview targets and cross-project proposals are dropped   |
| `overview`    | For each project whose memories changed (and `global`), Claude Code writes a new overview that supersedes the previous one |

Only one dream runs at a time; a second start reports `already_running`. A crashed
worker shows as `failed` on the next status read. A failed dream leaves
`last_success_at` unchanged, so the next run re-uploads the same window and
continues from the distill watermarks. Read `dream.log` for the cause.

## Endpoints

| Endpoint                | Clients                    | Tools                                                                                         |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| `/mcp`                  | CoS memory client          | All, including `memory_profile`, `memory_dream_start`, `memory_dream_status`, `memory_health` |
| `/mcp/read` (stateless) | Manager, `battuta-project` | `memory_recall`, `memory_types`, `memory_project_overview`, `memory_project_descriptions`     |
| `POST /archive`         | CoS memory client          | NDJSON conversation upload, at most 8 MiB, loopback only                                      |

See the [tool reference](memory-tools.md) for arguments and results.
