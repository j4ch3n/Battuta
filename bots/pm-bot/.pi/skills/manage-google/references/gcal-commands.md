# Google Calendar commands

Use the command's `--help` or `gog schema calendar <command> --json` for the
installed version's flags. The table identifies operations; it is not
complete invocation syntax. Select the account explicitly and verify writes
as described in the `manage-google` skill.

Invoke as `gog calendar <command>`.

| Command                              | User-visible effect                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| `calendars`                          | List available calendars                                        |
| `events`, `event`                    | List events or retrieve one event                               |
| `search`                             | Find events                                                     |
| `changed`                            | List recent event changes, including deletions                  |
| `freebusy`, `conflicts`              | Inspect availability or busy-time overlaps                      |
| `create`, `update`, `delete`         | Create, change, or remove events                                |
| `respond`                            | Respond to an invitation                                        |
| `move`                               | Move an event to another calendar                               |
| `focus-time`, `out-of-office`        | Create availability blocks                                      |
| `working-location`                   | Set home, office, or custom working location                    |
| `propose-time`                       | Generate a browser URL to propose another meeting time          |
| `create-calendar`, `delete-calendar` | Create a secondary calendar or delete an owned calendar         |
| `subscribe`, `unsubscribe`           | Add or remove a calendar from the account's calendar list       |
| `alias`                              | Manage calendar aliases                                         |
| `acl`                                | List calendar access permissions                                |
| `colors`                             | Inspect available colors                                        |
| `raw`                                | Retrieve lossless raw event JSON                                |
| `team`                               | Show Workspace group members' events with supported credentials |
| `users`                              | List Workspace users whose emails can serve as calendar IDs     |
| `time`                               | Inspect server time                                             |

## Sources

Adapted from gogcli's generated
[Calendar skill](https://github.com/openclaw/gogcli/blob/main/.agents/skills/gog-calendar/SKILL.md)
and [shared gog guidance](https://github.com/openclaw/gogcli/blob/main/.agents/skills/gog/SKILL.md).
Consult the [gogcli project](https://github.com/openclaw/gogcli) for
version-specific command documentation.
