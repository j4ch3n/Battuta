# Luma runtime and acceptance

PM connects directly to the official `https://mcp.luma.com` server using Pi 1.3.0
native streamable HTTP and CIMD OAuth. No Battuta proxy, token parser, or paid API
is involved. Source and release configuration create the same `luma` entry; TL
does not receive one.

## Access boundary

The server defaults to hidden exposure. Read-like tool names (`search_*`,
`lookup_*`, `get_*`, `list_*`, `find_*`) are exposed through native codemode;
everything else remains hidden. This is client-side tool exposure, not a narrower
Luma OAuth grant or a sandbox. Luma grants account-level access, and tool naming
alone cannot establish read-only semantics. Authenticated tool descriptions must
be reviewed before accepting this integration; unknown tools remain hidden unless
they match one of those patterns.

Pi owns refresh and authentication failures. PM must distinguish authorization,
permission, rate-limit, and service failures from a successful empty result, and
must never broaden tools to work around a failure. Information returned by Luma
can enter the PM model context and conversation transcript; do not request private
guest/contact information unnecessarily.

## Developer verification and product acceptance

Offline configuration tests cover PM/TL separation, the CIMD/exposure contract,
idempotence, retention of custom servers, and unchanged private OAuth-state bytes
and permissions in both source and release setup. They do not prove provider-side
authorization, live search behavior, token refresh, or successful revocation.

The inspected upstream 1.3.0 MCP implementation stores credentials in
`<PI_CODING_AGENT_DIR>/mcp-auth.json`, keyed by server name and normalized URL.
Changing the installation root does not change that identity if the file is
retained and the server name/URL stay the same. The file is plaintext JSON with
private creation permissions; backups require the same protections. Pi's auth
backend preserves existing file modes rather than repairing insecure ones.

After owner authorization, perform the following **separate acceptance test**,
not as an installation check:

1. Inspect the authenticated official tool descriptions and schemas. Confirm
   discovery and lookup are available, matched tools are read-only, and mutation
   and diagnostic-feedback tools remain hidden.
2. From the owner's PM Telegram conversation, search upcoming London public
   events using a specified topic and bounded future dates. Retrieve one result's
   details. Confirm source links, date/time with timezone, location and price when
   provided, with missing fields and empty results called out honestly.
3. Exercise supported attending/hosting lookups only within the owner's granted
   permissions. Record capability/access limits without retaining private data.
4. Verify owner logout/relogin and actionable reporting for missing authorization,
   insufficient access, and unavailable service. Do not mutate events or revoke
   unrelated grants to manufacture failures.

Record actual test dates, tool capabilities, results, and limitations in the
ticket. Live OAuth, tool-schema review, London search/lookup, and error/refresh
acceptance remain pending until they are performed with owner authorization.
