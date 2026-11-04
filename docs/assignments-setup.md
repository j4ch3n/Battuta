# Assignment MCP setup

Run as the ordinary bot user. Keep Supabase credentials in the existing private
environment file; do not paste or print them. This service uses the existing
Supabase URL/secret key, not a new OAuth login or task CLI.

## Backend

The Supabase project must have this checkout's migrations applied and the
`assignments` Edge Function deployed. Use the repository's existing Supabase
deployment workflow for a remote project, with normal operator approval.
`[functions.assignments] verify_jwt = false` delegates authentication to the
secret-key handler; it does not make the MCP service public.

For an already running local development instance, apply additive migrations and
serve functions from the checkout:

```sh
supabase migration up --local
supabase functions serve assignments
```

Expected: migrations apply without resetting existing data and the local function
server reports its endpoint. Stop on migration/runtime errors; do not reset the
database to bypass them. Do not start another server if one is already serving.

## Bot configuration

Source configuration and release `bin/battuta configure` generate the
`assignments` entry for CoS/Manager and an assignment-only worker profile. It uses
`<SUPABASE_URL>/functions/v1/assignments` and the literal environment placeholder
`${SUPABASE_SECRET_KEY}` in the `apikey` header. Remote origins require HTTPS;
loopback HTTP is allowed for development. Runtime processes need the secret in
their environment; configuration does not embed its value.

After the normal configuration command, check files without invoking a model or
mutating remote task state:

```sh
python3 - <<'PY'
import json
from pathlib import Path
for profile in ('cos-bot', 'manager-bot', 'worker'):
    path = Path('bots') / profile / '.pi/mcp.json'
    entry = json.loads(path.read_text())['mcpServers']['assignments']
    assert entry['url'].endswith('/functions/v1/assignments')
    assert entry['headers'] == {'apikey': '${SUPABASE_SECRET_KEY}'}
    assert entry['exposure'] == 'codemode'
    assert path.stat().st_mode & 0o777 == 0o600
print('Assignment MCP configuration checks passed')
PY
```

Expected: the success line only; any assertion/missing file fails setup. Preserve
custom servers, OAuth grants, and private sessions. Restart bots separately only
when authorized. Worker profile configuration does not create worker sessions or
change the existing bounded-subagent isolation defaults; its future session
launcher must explicitly consume this profile.

Notes need no editor package or service: bots use Pi's file tools at returned
paths. Verify project registration using `battuta-project list`; missing project
context requires owner confirmation, not a general-scope fallback.
