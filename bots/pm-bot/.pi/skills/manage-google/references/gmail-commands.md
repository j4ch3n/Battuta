# Gmail commands

Use the command's `--help` or `gog schema gmail <command> --json` for the
installed version's flags. The table identifies operations; it is not
complete invocation syntax. Select the account explicitly and verify writes
as described in the `manage-google` skill.

Invoke as `gog gmail <command>`.

| Command               | User-visible effect                                                               |
| --------------------- | --------------------------------------------------------------------------------- |
| `search`, `messages`  | Find threads or work with individual messages                                     |
| `get`, `thread`       | Read a message/thread; thread commands also modify threads                        |
| `raw`                 | Retrieve lossless raw message JSON                                                |
| `attachment`          | Download a message attachment                                                     |
| `url`                 | Get a thread's Gmail web URL                                                      |
| `drafts`              | Create, inspect, update, delete, or send drafts                                   |
| `send`                | Send new email                                                                    |
| `reply`, `reply-all`  | Reply in the existing conversation, preserving its subject and quoting by default |
| `forward`             | Forward a message to new recipients                                               |
| `autoreply`           | Reply once to matching messages                                                   |
| `labels`              | Manage labels                                                                     |
| `archive`             | Remove messages or explicit threads from the inbox                                |
| `mark-read`, `unread` | Change read status                                                                |
| `trash`               | Move messages to trash                                                            |
| `batch`               | Apply bulk operations; permanent deletion needs broader Gmail scope               |
| `history`             | Inspect Gmail history                                                             |
| `import`              | Import an RFC822/EML message                                                      |
| `settings`            | Change Gmail settings/admin configuration                                         |
| `track`               | Manage email-open tracking                                                        |

For normal replies, discover `gmail reply <messageId> --body-file <path>` or
`gmail reply-all` instead of reconstructing MIME with `gmail send`. These
commands preserve conversation details; recipient flags can add or move
recipients, so inspect the final recipients before sending.

## Sources

Adapted from gogcli's generated
[Gmail skill](https://github.com/openclaw/gogcli/blob/main/.agents/skills/gog-gmail/SKILL.md)
and [shared gog guidance](https://github.com/openclaw/gogcli/blob/main/.agents/skills/gog/SKILL.md).
For manual installation and authentication, follow the
[gogcli setup guide](../../../../../../docs/gogcli-setup.md).
Consult the [gogcli project](https://github.com/openclaw/gogcli) for
version-specific command documentation.
