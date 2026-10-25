# Luma connection setup (PM only)

Battuta uses [Luma's official MCP server](https://help.luma.com/p/mcp) through
[Pi's native OAuth support](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/mcp.md#authenticate-with-oauth).
A regular Luma account is enough; no Luma Plus, API key, client secret, or paid API
is required. TL is not configured for Luma.

See [runtime boundaries and product acceptance](luma.md) for the separate live
verification procedure; do not use bot/model requests as installation checks.

## 1. Check configuration

Run normal Battuta configuration first. PM's `.pi/mcp.json` must contain:

```json
{
  "mcpServers": {
    "luma": {
      "url": "https://mcp.luma.com",
      "oauth": { "clientRegistration": "cimd" },
      "exposure": "hidden",
      "toolExposure": {
        "search_*": "codemode",
        "lookup_*": "codemode",
        "get_*": "codemode",
        "list_*": "codemode",
        "find_*": "codemode"
      },
      "description": "Discover Luma events and look up event/account details; read-only use"
    }
  }
}
```

Inspect only this entry, not private auth files. Preserve the other servers. The
Luma entry has no `Authorization` header: Pi must handle OAuth, and CIMD is
required because Luma does not support dynamic client registration.

## 2. Owner sign-in

Run as the ordinary user who runs PM, from the extracted release root. Do not run
with `sudo`. With the owner's approval, run:

```sh
(cd bots/pm-bot && PI_CODING_AGENT_DIR="$PWD/.pi" ../../bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp login luma)
```

The owner completes Luma's browser authorization, checking the account and access
being granted. Over SSH, open the authorization page on the owner's browser and
paste the resulting redirected URL into Pi's sign-in prompt if the callback
cannot reach the Raspberry Pi. Paste it only into that prompt, never chat,
documentation, shell history, or a log. Stop if authorization fails; do not launch
PM expecting it to repair authentication.

If PM is already running interactively, the owner can instead use
`/mcp login luma` in that same PM Pi session; its next turn uses the new login.
This is separate from `/login`, which authenticates the model provider.

For a source checkout, use the same bot environment:

```sh
(cd bots/pm-bot && PI_CODING_AGENT_DIR="$PWD/.pi" node_modules/.bin/pi mcp login luma)
```

For a custom PM workspace, use its directory and installed Pi executable instead.
A login under the default `~/.pi/agent` directory is not a login for Battuta PM.

## 3. Validate without a bot or model request

From the release root, with the normal production credential environment loaded:

```sh
(cd bots/pm-bot && PI_CODING_AGENT_DIR="$PWD/.pi" ../../bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp list)
test -s bots/pm-bot/.pi/mcp-auth.json
test "$(stat -c '%a' bots/pm-bot/.pi/mcp-auth.json)" = 600
```

Expect `luma` connected with tools listed, the effective exposure shown for its
tools, and all commands to exit zero. `mcp list` also checks other configured
servers, including Linear and memory; a nonzero exit is a setup failure even if
Luma connected. Stop and resolve the reported failure before launching. For a
source checkout, substitute `node_modules/.bin/pi` as above; on macOS use
`stat -f '%Lp'` instead of `stat -c '%a'`.

The exposure patterns permit discovery and lookup tools, while tools not matching
them remain hidden. Review the connected tool descriptions before use: a naming
pattern is not proof of a tool's effects or a provider-side read-only permission.
If a matching tool can mutate data, keep PM stopped and narrow the configuration
before proceeding. Do not enable RSVP, purchase, event/guest changes, messages,
or Luma's diagnostic-note submission tools.

## 4. Disconnect and recover access

- **Local disconnect:** run the login command above with `mcp logout luma`
  instead. Pi removes that server's saved credential. To prevent reconnecting,
  set the PM entry's `enabled` to `false` and restart PM; normal Battuta
  configuration recreates the managed entry.
- **Provider revocation:** local logout removes local state; it does not promise
  that the Luma grant is revoked. Use Luma's account authorization controls or
  contact Luma support to revoke it. Do not extract a refresh token or call its
  revocation endpoint manually from chat.
- **Expired/revoked login or changed scopes:** Pi refreshes tokens automatically
  where possible. If it requests sign-in, the owner repeats `mcp login luma`.
  For a wrong account, log out first, then sign in to the intended account.
- **Insufficient access:** the connection only sees events, calendars, and account
  information allowed by the owner's Luma account. Verify that account and its
  permissions; logging in cannot grant missing event-management access.
- **Timeout, rate limit, or service failure:** report unavailability rather than
  treating it as an empty search. Retry later after checking connectivity; do not
  replace OAuth with a paid API or broaden exposed tools.

## 5. Preserve login during release upgrades

Pi keeps OAuth state as private JSON at
`bots/pm-bot/.pi/mcp-auth.json` because Battuta sets `PI_CODING_AGENT_DIR` to
PM's `.pi`. It is **not encrypted**. Protect it and backups like model-provider
`auth.json`: mode `600`, only accessible to the bot user, outside source control,
release archives, prompts, and shared logs. Pi creates new files privately but
does not repair overly broad existing permissions.

Stop all old and new PM processes before backup/restore so refresh cannot race
with migration. Updating the same stable directory preserves this file in place;
never overwrite it while extracting a release. Both configuration implementations
leave it untouched. For a move to a new root, restore the backed-up PM OAuth file
alongside PM's other retained private state **before** running configuration or
launching Pi. Do not restore TL's file into PM.

If the rest of PM's private state has already been migrated but this file has not,
run the following as the bot user, substituting the actual old and new roots:

```sh
old_root="$HOME/apps/battuta-old"
new_root="$HOME/apps/battuta"
source_auth="$old_root/bots/pm-bot/.pi/mcp-auth.json"
target_auth="$new_root/bots/pm-bot/.pi/mcp-auth.json"
test -f "$source_auth" && test -r "$source_auth" || exit 1
test -d "$new_root/bots/pm-bot/.pi" || exit 1
test ! -e "$target_auth" && test ! -L "$target_auth" || exit 1
install -m 600 "$source_auth" "$target_auth" || exit 1
cmp -s "$source_auth" "$target_auth" || exit 1
test "$(stat -c '%a' "$target_auth")" = 600 || exit 1
```

Expect zero exits and no credential output. If the destination already exists,
stop rather than overwrite or merge credential JSON; preserve both copies and
determine which is current before proceeding. If the old installation predates
Luma login and has no file, there is nothing to migrate: use owner sign-in instead.
Keep the server name `luma` and URL unchanged so Pi can reuse the stored grant.
Run configuration and the CLI checks above after migration; a revoked or expired
grant may still require owner sign-in.
