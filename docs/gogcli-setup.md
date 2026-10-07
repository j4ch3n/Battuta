# gogcli installation and headless Google login

This is the setup reference for the PM bot's Gmail and Calendar access. `gog`
is an external command and is not bundled with Battuta. Run
checks as the ordinary user who will run the bot. Installation and Google
authentication are manual owner steps; an installation agent can inspect and
explain results but must not automate either step. Never share OAuth secrets,
tokens, callback URLs, or keyring passwords in chat or setup logs.

## Installation defaults

- Version: **v0.43.0**
- Platform: **Linux ARM64**
- Executable: `~/.local/bin/gog`
- OAuth client file: `~/.credentials/google_client_secret.json`
- Keyring: encrypted file backend
- Keyring password: `GOG_KEYRING_PASSWORD`, supplied privately in the runtime environment
- Required services: Gmail and Calendar

## 1. Install the correct release

**Already done?** Check the installed command and version:

```bash
command -v gog
gog --version
```

If a compatible installation is available, reuse it and continue to step 2.
Otherwise, the owner should check the platform before downloading:

```bash
uname -sm
```

For `Linux aarch64`, use the Linux ARM64 archive below. For another platform,
select its matching archive and published checksum from the
[gogcli releases](https://github.com/openclaw/gogcli/releases). The Darwin AMD64
archive is for Intel macOS.

```bash
mkdir -p ~/.local/bin
curl -fL --retry 3 \
  -o /tmp/gogcli_0.43.0_linux_arm64.tar.gz \
  https://github.com/openclaw/gogcli/releases/download/v0.43.0/gogcli_0.43.0_linux_arm64.tar.gz

printf '%s  %s\n' \
  f66e3c9ab7664b7633d57d2d5303e0db75deb4045e1b32c3493c0d8ba68a70f7 \
  /tmp/gogcli_0.43.0_linux_arm64.tar.gz | sha256sum -c -
```

After the checksum passes, install and verify:

```bash
tar -xzf /tmp/gogcli_0.43.0_linux_arm64.tar.gz -C ~/.local/bin ./gog
gog --version
```

If needed, add `~/.local/bin` to your shell's `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

After successful verification, remove the archive:

```bash
rm /tmp/gogcli_0.43.0_linux_arm64.tar.gz
```

## 2. Ask which Google account to use

After the package has been downloaded, installed, and verified (or an existing
installation reused), ask the owner for the Google email address to authorize.
Do not assume an address or choose one merely because it is already configured.
In the owner's terminal, store that answer for the commands below:

```bash
read -r -p 'Google account email: ' ACCOUNT
test -n "$ACCOUNT"
```

Use the same terminal for the following steps so `ACCOUNT` stays available.
If the address is empty, ask again before continuing.
Check existing authentication:

```bash
gog auth list --check
```

If the selected account reports valid authentication and Gmail and Calendar
service access, reuse it and continue to step 7. An account merely appearing
in the list does not prove its authentication is valid. If the command cannot
unlock the keyring, resolve keyring access below before deciding whether
reauthentication is needed. If setup is deferred, Google operations remain
unavailable until the verification checks pass.

## 3. Prepare Google OAuth credentials

If creating a new OAuth client:

1. Open <https://console.cloud.google.com/apis/credentials> and select or create a project.
2. Configure the OAuth consent screen. If the app is in Testing mode, add the accounts you intend to authorize as test users.
3. Enable the Gmail API and Google Calendar API.
4. Create an OAuth client ID with application type **Desktop app**.
5. Download the client JSON file and save it locally.

The default local path used by this guide is:

```text
~/.credentials/google_client_secret.json
```

Use the actual saved path in the import command if the owner chose another
location. Reuse an existing client when it is valid.

## 4. Configure the encrypted file keyring

For a headless machine without a working system keyring, use the file backend:

```bash
gog auth keyring file
```

If the owner already configured the password privately in `~/.bashrc`, load it:

```bash
source ~/.bashrc
export GOG_KEYRING_PASSWORD
```

For a new setup without that variable, enter a password without displaying it or putting its value into shell history:

```bash
read -r -s -p 'Gog keyring password: ' GOG_KEYRING_PASSWORD
printf '\n'
export GOG_KEYRING_PASSWORD
```

Use the same password for subsequent commands that access this encrypted keyring.

Import the OAuth client credentials:

```bash
gog auth credentials set ~/.credentials/google_client_secret.json
```

## 5. Start headless login

Use the account selected in step 2. For an existing account being
reauthenticated, inspect its current service list and preserve any broader
access the owner still needs instead of silently narrowing it to Gmail and
Calendar.

Generate a fresh browser authorization URL:

```bash
gog auth add "$ACCOUNT" --remote --step 1 \
  --services gmail,calendar --no-input
```

Open the exact generated `auth_url` in a browser on any device. Sign in with the selected account and approve Gmail and Calendar access.

Google redirects to a URL resembling:

```text
http://127.0.0.1:PORT/oauth2/callback?state=...&code=...&scope=...
```

The localhost page may fail to load; this is expected for this remote flow. Copy the **complete URL** from the browser address bar.

## 6. Complete headless login

Read the callback URL without saving it in shell history:

```bash
read -r -p 'Paste the complete callback URL: ' CALLBACK_URL

gog auth add "$ACCOUNT" --remote --step 2 \
  --services gmail,calendar \
  --auth-url "$CALLBACK_URL" --no-input

unset CALLBACK_URL
```

Use the same account, service selection, client, and config root as step 5. Complete one account's flow before starting another.

## 7. Verify Google access

```bash
gog auth list --check
```

The selected account must report valid authentication with Gmail and Calendar
service access. For automation, use `gog auth list --check --json --no-input`.

Select the account explicitly when using commands:

```bash
gog --account "$ACCOUNT" gmail --help
gog --account "$ACCOUNT" calendar --help
```

Then verify actual read access:

```bash
gog --readonly --no-input --account "$ACCOUNT" gmail search 'newer_than:1d' --max 1 --json --wrap-untrusted
gog --readonly --no-input --account "$ACCOUNT" calendar events --today --json --wrap-untrusted
```

Inspect results locally without posting private messages or event data into
setup logs/chat. Empty successful results are valid; authentication,
permission, or keyring errors are not. For unsupported flags, consult the
installed version's command help rather than guessing.

To authorize another account, ask for its email and repeat steps 2 and 5–7.
The OAuth client and keyring setup can be reused.

## 8. Verify the PM bot's runtime and service

In the running PM Pi session, ask the bot to use `manage-google` for a read-only
agenda lookup with the selected account and run
`gog auth list --check --json --no-input`. This checks skill discovery and
Google access without sending email or invitations.

For a user service, make `gog` available on the PM service's PATH using the
[release service setup](../RELEASE.md#6-optional-run-as-user-services).
Shell PATH changes alone do not apply to systemd units. For a file keyring,
the owner must privately provide the matching `GOG_KEYRING_BACKEND=file`,
`GOG_KEYRING_PASSWORD`, and `HOME` in the service's runtime environment. Never
print the password. Battuta's release launcher loads `.env.prod`; shell
startup files alone do not establish the service's environment.

Repeat the checks through the running PM bot after restarting it to load any
environment changes. A successful login-shell check is insufficient. Resolve
runtime/keyring errors before treating unattended Google operations as ready.

## Troubleshooting

### No TTY available for keyring password prompt

Ensure `GOG_KEYRING_PASSWORD` is exported in the shell running `gog`:

```bash
source ~/.bashrc
export GOG_KEYRING_PASSWORD
```

If `.bashrc` skips initialization in non-interactive shells, load it through an interactive Bash shell:

```bash
bash -ic 'export GOG_KEYRING_PASSWORD; gog auth list --check'
```

### Manual auth state mismatch or expired authorization code

Start a fresh authorization flow in step 5 (`--step 1`), open its newly
generated URL, and use the new callback in step 6 (`--step 2`). Do not reuse
callbacks from earlier flows.

### Invalid OAuth scope

Use the generated authorization URL exactly as printed. The email scope is:

```text
https://www.googleapis.com/auth/userinfo.email
```

Omitting `/auth/` produces an invalid scope.

### Access denied for a testing OAuth app

Add the account to the OAuth consent screen's test users. A Workspace account may also require its organization's administrator to allow the OAuth app.
