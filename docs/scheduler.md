# PM scheduler

Battuta installs unmodified `npm:@jl1990/pi-scheduler@0.5.1` (upstream tag `v0.5.1`) for PM only. See the [upstream command reference](https://github.com/jl1990/pi-scheduler/tree/v0.5.1) for all options. No scheduler fork or separate service is required.

## Storage and launch

Source PM setup and release `bin/battuta configure` initialize the native version-2 store at **`~/.battuta/schedule-prompts.json`**. Repeated configuration preserves existing tasks. It does not create a dream task. Setup must run with PM stopped.

Set `PI_SCHEDULER_STATE_FILE` in the selected `.env`/`.env.prod` to override the path. Use an absolute filename; blank, relative, and literal `~` paths are rejected. Source dev/prod, release foreground, and user services resolve the same default. Keep the same persistent service user and HOME across releases. Run only one PM process against the store.

Launch validates the existing store before loading Pi and never initializes or imports one. Missing files, malformed JSON, and invalid native envelopes require operator attention; launch leaves them untouched. PM runs with umask `077` so upstream atomic replacements remain private. Existing parent directories are not repermissioned by setup: keep the parent private too.

For an explicit source-only initialization or diagnostic:

```sh
node memory-client/configure-scheduler.mjs --initialize
node memory-client/configure-scheduler.mjs --check
```

Load the selected environment first; use `bin/node` in a release. These commands neither launch PM nor enable dream.

## Using schedules

Ask PM to use `schedule_task` with `action:"prompt"` to wake the agent, then confirm it through `list_scheduled_tasks`. For example, ask for a global reminder in five minutes to check a deployment and report its observed status. Use `manage_scheduled_task` to update, enable, disable, or remove tasks, and `cancel_scheduled_task` to cancel one. `/schedule prompt 5m :: Check deployment status` is a command alternative; commands default to session scope. `/remind` is a notification, not automatically an agent turn or Telegram delivery.

- `session` (default): bound to the creating session file. A different session cannot see or run it.
- `cwd`: bound to the creating working directory. A new release directory is a different scope.
- `global`: eligible across PM sessions and release directories using the same store. Select this explicitly for durable owner reminders.

Schedules fire only while Pi is running. Battuta defaults `PI_SCHEDULER_CATCHUP_MAX=0` to avoid replaying general missed cron prompts. An explicit nonnegative integer enables upstream's bounded cron replay (default window: 24 hours). This is not an OS wake-up facility or a promise to replay every missed interval. One-shot/interval behavior follows upstream; test the intended reminder and scope before relying on it.

Scheduler history records prompt delivery, **not completion of the requested work**. A delivered dream prompt still requires PM to call `memory_dream`; refusal or interruption is not a completed dream. Dream has its own latest-due startup catch-up and persistent completion checkpoint.

Upstream treats a missing runtime file as an empty store and sanitizes some invalid task records. Battuta's launch checks do not harden every upstream runtime read or prevent deletion/corruption after launch. Keep backups; investigate disappearance or errors rather than automatically creating a replacement over private state.

## Fresh cutover only

Stop the old PM first. Use a clean bot workspace/settings, run normal configuration for the new package/store, and recreate owner reminders explicitly with their intended scope. Do not enable both schedulers. There is no old-format import, retained-old-settings conversion, or automatic deletion of old schedules, auth, sessions, or memory. Keep old private files backed up outside active configuration.

The optional nightly dream needs separate owner approval and explicit configuration; its setup entry is listed in the release setup index.
