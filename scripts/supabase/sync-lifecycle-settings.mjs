// Validates config/assignment-lifecycle.yaml and prints the SQL that stores it in assignment_settings.
// Usage: node scripts/supabase/sync-lifecycle-settings.mjs [path] > settings.sql
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const DURATIONS = {
  lease: ["duration"],
  heartbeat: ["interval"],
  expiry: ["check_interval"],
  progress: ["report_after"],
  ask: ["chase_after"],
};
const SQL_PLACEHOLDERS = ["assignment_id", "worker", "claimed_at"];
const WORKER_PLACEHOLDERS = [...SQL_PLACEHOLDERS, "position"];
const MESSAGES = {
  expiry_blocker: SQL_PLACEHOLDERS,
  manager_expiry_notice: SQL_PLACEHOLDERS,
  progress_request: SQL_PLACEHOLDERS,
  idle_reminder: WORKER_PLACEHOLDERS,
  no_report_blocker: WORKER_PLACEHOLDERS,
  ask_chase: WORKER_PLACEHOLDERS,
};
// Agent-mail limits (objective 2000, body 4000) less headroom for filled placeholders.
const LIMITS = { objective: 1900, body: 3900 };
const UNITS = { s: 1, m: 60, h: 3600 };

function fail(message) {
  throw new Error(`Invalid lifecycle settings: ${message}`);
}
function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${path} must be a mapping`);
  return value;
}
function exactKeys(value, keys, path) {
  for (const key of keys) if (!(key in value)) fail(`${path}${key} is required`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${path}${key} is not allowed`);
}
function seconds(value, path) {
  const match = typeof value === "string" ? /^(\d+)([smh])$/.exec(value) : null;
  if (!match || Number(match[1]) === 0) fail(`${path} must be a positive <n>s|m|h duration`);
  return Number(match[1]) * UNITS[match[2]];
}

/** Parses and validates the YAML; returns the stored shape with durations in integer seconds. */
export function loadSettings(text) {
  const value = object(parse(text), "settings");
  exactKeys(value, [...Object.keys(DURATIONS), "roles", "messages"], "");
  const settings = {};
  for (const [section, keys] of Object.entries(DURATIONS)) {
    exactKeys(object(value[section], section), keys, `${section}.`);
    settings[section] = Object.fromEntries(
      keys.map((key) => [key, seconds(value[section][key], `${section}.${key}`)]),
    );
  }
  const lease = settings.lease.duration,
    heartbeat = settings.heartbeat.interval,
    check = settings.expiry.check_interval;
  if (heartbeat >= lease) fail("heartbeat.interval must be shorter than lease.duration");
  if (check < 60) fail("expiry.check_interval must be at least 1m");
  // pg_cron runs every n minutes only for whole minutes up to 59.
  if (check % 60 !== 0 || check > 59 * 60)
    fail("expiry.check_interval must be a whole number of minutes up to 59m");
  if (settings.progress.report_after <= check)
    fail("progress.report_after must be longer than expiry.check_interval");

  exactKeys(object(value.roles, "roles"), ["manager"], "roles.");
  if (
    typeof value.roles.manager !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.roles.manager)
  )
    fail("roles.manager must be a mail role name");
  settings.roles = { manager: value.roles.manager };

  exactKeys(object(value.messages, "messages"), Object.keys(MESSAGES), "messages.");
  settings.messages = {};
  for (const [name, allowed] of Object.entries(MESSAGES)) {
    const message = object(value.messages[name], `messages.${name}`);
    exactKeys(message, ["objective", "body"], `messages.${name}.`);
    for (const [field, limit] of Object.entries(LIMITS)) {
      const text = message[field];
      if (typeof text !== "string" || !text.trim() || text.length > limit)
        fail(`messages.${name}.${field} must be nonblank text of at most ${limit} characters`);
      for (const [, placeholder] of text.matchAll(/\{([^}]*)\}/g))
        if (!allowed.includes(placeholder))
          fail(`messages.${name}.${field} cannot use {${placeholder}}`);
    }
    settings.messages[name] = { objective: message.objective, body: message.body };
  }
  return settings;
}

/** One statement for psql or `supabase db query`; the JSON is a single-quoted SQL literal. */
export function statement(settings) {
  return `select public.assignment_settings_apply('${JSON.stringify(settings).replaceAll("'", "''")}'::jsonb);\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = resolve(
    process.argv[2] ?? resolve(import.meta.dirname, "../../config/assignment-lifecycle.yaml"),
  );
  try {
    process.stdout.write(statement(loadSettings(readFileSync(path, "utf8"))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
