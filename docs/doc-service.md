# Document service operations

One local server at `http://127.0.0.1:8903` (`/mcp`, `/health`) converts documents into Markdown
folders with Docling. It is registered only in Claude Code's user configuration on the main
bundle, so only Claude Code sessions that Workers delegate to can call it. CoS, Manager and Pi
Workers do not see it. Conversion runs on this host and never sends document bytes to a hosted
parser. Text a delegated session then reads from the result reaches its own model.

## Tools

| Tool                 | Purpose                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `doc_convert`        | Convert a file and block until done (up to 15 minutes). Repeating an identical call joins it. |
| `doc_job`            | Progress or final result for a `doc_id`. Never waits.                                         |
| `doc_page_image`     | Render one page of a converted PDF to PNG, for checking tables, OCR and charts.               |
| `doc_service_status` | Readiness, models, running and queued jobs, cache size, limits.                               |
| `doc_list`           | Converted documents kept by the service.                                                      |
| `doc_delete`         | Delete one document by `doc_id`, or every document older than N days.                         |

`doc_convert` parameters: `source` (absolute path), `pages` (such as `1-5,9`), `ocr`
(`auto`, `off`, `force`), `ocr_languages`, `tables` (`off`, `fast`, `accurate`), `figures`
(`off`, `extract`, `describe`), `charts` (default on) and `formulas` (default off). Results
and errors are JSON text; errors carry a `code`. While a call blocks, the server sends an MCP
progress notification every 15 seconds. A job still running at the wait cap returns
`status: "running"` with a `next_step` telling the caller to repeat the call.

A non-contiguous `pages` list converts the range from its first to its last page.

## Result folder

`~/.battuta/doc-service/docs/<doc_id>/`, where `doc_id` hashes the file bytes, suffix, options
and Docling version, so the same file with the same options is converted once.

| Path                           | Content                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `INDEX.md`                     | Map: files, outline, tables, figures, page-to-line table. Written last.        |
| `document.md`, `document.json` | Markdown (figures marked `<!-- fig-NNN -->`) and the lossless Docling document |
| `tables/tbl-NNN.csv`           | One CSV per table                                                              |
| `figures/fig-NNN.png`, `.csv`  | Figure images and extracted chart data                                         |
| `source.pdf`, `pages/pNNN.png` | Copy of a PDF input, and page renders made on demand                           |
| `status.json`                  | Job state, options, timings, warnings                                          |

## Limits and safety

| Limit               | Variable                          | Default               |
| ------------------- | --------------------------------- | --------------------- |
| Input size          | `BATTUTA_DOC_MAX_BYTES`           | 104857600             |
| Pages per document  | `BATTUTA_DOC_MAX_PAGES`           | 500                   |
| Blocking wait       | `BATTUTA_DOC_MAX_WAIT_SECONDS`    | 900                   |
| Job timeout         | `BATTUTA_DOC_JOB_TIMEOUT_SECONDS` | 3600                  |
| Queued jobs         | `BATTUTA_DOC_MAX_QUEUE`           | 4                     |
| Retention           | `BATTUTA_DOC_RETENTION_DAYS`      | 14                    |
| Allowed input roots | `BATTUTA_DOC_INPUT_ROOTS`         | `~/.battuta/projects` |

One conversion runs at a time. Sources must be absolute local paths under an input root after
symlinks are resolved; URLs are rejected. A restart marks any job left running as
`failed` with code `service_restarted`; repeating the call reruns it. Results are private to the
service user and swept after the retention period.

## Models and privacy

Models download on first start into `~/.battuta/doc-service/models`, and `/health` reports
`warming_up` until they are present. Tool calls during that time return `warming_up` with
`retry_after_seconds`. Afterwards the service sets `HF_HUB_OFFLINE=1`, so conversions use no
network; the optional picture-description model is the only later download, on first use of
`figures="describe"`. Hugging Face telemetry is always disabled.

## Recovery

| Code                                 | Meaning and action                                      |
| ------------------------------------ | ------------------------------------------------------- |
| `warming_up`, `busy`                 | Retry after the stated delay                            |
| `too_large`, `too_many_pages`        | Convert a page range or split the file                  |
| `encrypted`, `unreadable`            | Needs an unlocked or undamaged copy                     |
| `path_not_allowed`, `invalid_source` | Move the file under an input root, use an absolute path |
| `job_timeout`, `conversion_failed`   | Retry with `charts=false` or a smaller `pages` range    |
