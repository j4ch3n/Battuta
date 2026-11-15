# Assignment remote files setup

The Supabase project needs the assignment migrations, the private
`assignment-files` bucket migration, and the `assignment-files` Edge Function.
Use the existing operator-approved Supabase deployment workflow. The function's
`verify_jwt = false` delegates authentication to its secret-key handler; it does
not make the service public. The gateway must provide trustworthy forwarded
host, port, and protocol headers so download links point to the public origin.

Configure worker profiles using the existing bot setup workflow. No new
credential is needed: the worker MCP configuration references the existing
`SUPABASE_SECRET_KEY` environment variable. Check source configuration without
printing credentials or contacting bots:

```sh
python3 - <<'PY'
import json
from pathlib import Path
profile = Path("bots/worker/.pi")
server = json.loads((profile / "mcp.json").read_text())["mcpServers"]["assignment-files"]
assert server["url"].endswith("/functions/v1/assignment-files")
assert server["headers"] == {"apikey": "${SUPABASE_SECRET_KEY}"}
assert server["exposure"] == "hidden"
assert set(server["toolExposure"]) == {"list_assignment_files", "download_assignment_file"}
assert (profile / "skills/access-remote-files/SKILL.md").is_file()
print("Worker remote file configuration checks passed")
PY
```

The success line is the expected result; stop if any check fails. Review skipped
private configuration during release setup rather than overwriting it.
