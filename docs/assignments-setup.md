# Assignment MCP setup

Run as the ordinary bot user. Keep Supabase credentials in the existing private
environment file; do not paste or print them. This service uses the existing
Supabase URL/secret key, not a new OAuth login or task CLI.

## Backend

The Supabase project must have this checkout's migrations applied and the
`assignments` Edge Function deployed. Use the repository's existing Supabase
deployment workflow for a remote project, with normal operator approval.
The deployment workflow also stores the lifecycle settings from
`config/assignment-lifecycle.yaml` in the linked project. Claims are refused
with `not_configured` until the settings are stored.
`[functions.assignments] verify_jwt = false` delegates authentication to the
secret-key handler; it does not make the MCP service public.

For an already running local development instance, apply additive migrations and
serve functions from the checkout:

```sh
supabase migration up --local
node scripts/supabase/sync-lifecycle-settings.mjs > /tmp/lifecycle-settings.sql
supabase db query --local --file /tmp/lifecycle-settings.sql
supabase functions serve assignments
```

Expected: migrations apply without resetting existing data, the settings query
exits 0 (an invalid YAML file exits 1 before anything is written), and the local
function server reports its endpoint. Stop on migration/runtime errors; do not reset the
database to bypass them. Do not start another server if one is already serving.

## Bot configuration

Source bot configuration generates the role's `assignments` entry; prepare the
source worker profile separately with `configure --root . --role worker`.
Release `battuta-bot-setup configure-release --root DIR --env-file FILE` defaults
to the main deployment, configuring CoS, Manager and selected workers.
With `--deployment influencer`, it configures the selected influencer worker only.
Each role keeps its own tool restrictions. The assignment entry uses
`<SUPABASE_URL>/functions/v1/assignments` and the literal environment placeholder
`${SUPABASE_SECRET_KEY}` in the `apikey` header. Remote origins require HTTPS;
loopback HTTP is allowed for development. Runtime processes need the secret in
their environment; configuration does not embed its value.

The entry also sends `X-Battuta-Projects-Root: ${BATTUTA_PROJECTS_ROOT_HEADER}`.
Source/release launchers derive and encode this value from the bot user's home;
do not set it manually or ask the model to supply a root. Note operations fail
before writing metadata when the header is missing or invalid.

For source configuration, check files without invoking a model or
mutating remote task state:

```sh
python3 - <<'PY'
import json
from pathlib import Path
for profile in ('cos-bot', 'manager-bot', 'worker'):
    path = Path('bots') / profile / '.pi/mcp.json'
    entry = json.loads(path.read_text())['mcpServers']['assignments']
    assert entry['url'].endswith('/functions/v1/assignments')
    assert entry['headers'] == {
        'apikey': '${SUPABASE_SECRET_KEY}',
        'X-Battuta-Projects-Root': '${BATTUTA_PROJECTS_ROOT_HEADER}',
    }
    if profile == 'worker':
        assert entry['exposure'] == 'hidden'
        assert set(entry['toolExposure']) == {'list_assignments', 'get_assignment', 'prepare_notes', 'locate_notes'}
    else:
        assert entry['exposure'] == 'codemode'
    assert path.stat().st_mode & 0o777 == 0o600
print('Assignment MCP configuration checks passed')
PY
```

Expected: the success line only; any assertion/missing file fails setup. Release
setup creates missing private MCP files and leaves existing files untouched. Review
skipped configuration before starting bots. Restart bots separately only when authorized. Neither source nor release
configuration starts worker sessions.

Deploy the matching migration and clients together: note tools now accept only
project/assignment ID and return guidance containing the caller's full note path. Refresh generated
MCP entries to include the new header and use the matching launchers; existing
private files are preserved, so inspect skipped configuration before proceeding.
No new credentials are required. Workers need write permission
under their own expanded `~/.battuta` root; runtime code prepares only assignment
scratch directories and preserves existing files. Notes need no editor service
and are not synchronized. Project registration is not required for note-only
work; missing essential commission inputs still require an honest blocker.
