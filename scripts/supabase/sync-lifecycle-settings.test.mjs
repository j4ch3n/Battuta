import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { loadSettings, statement } from "./sync-lifecycle-settings.mjs";

const root = resolve(import.meta.dirname, "../..");
const source = readFileSync(resolve(root, "config/assignment-lifecycle.yaml"), "utf8");
const edit = (change) => {
  const value = parse(source);
  change(value);
  return stringify(value);
};

test("the repository settings load", () => {
  assert.doesNotThrow(() => loadSettings(source));
});

for (const [duration, seconds] of [
  ["90s", 90],
  ["2m", 120],
  ["1h", 3600],
]) {
  test(`a ${duration} lease is stored as ${seconds} seconds`, () => {
    assert.equal(loadSettings(edit((v) => (v.lease.duration = duration))).lease.duration, seconds);
  });
}

const invalid = {
  "missing key": (v) => delete v.ask,
  "unknown top-level key": (v) => (v.extra = 1),
  "bad duration": (v) => (v.lease.duration = "10 minutes"),
  "zero duration": (v) => (v.ask.chase_after = "0m"),
  "heartbeat not below lease": (v) => (v.heartbeat.interval = "10m"),
  "check interval under a minute": (v) => (v.expiry.check_interval = "30s"),
  "check interval not whole minutes": (v) => (v.expiry.check_interval = "90s"),
  "check interval over 59 minutes": (v) => (v.expiry.check_interval = "1h"),
  "report_after not above check interval": (v) => (v.progress.report_after = "1m"),
  "invalid manager role": (v) => (v.roles.manager = "the manager"),
};
for (const [name, change] of Object.entries(invalid)) {
  test(`rejects ${name}`, () => assert.throws(() => loadSettings(edit(change))));
}

test("the statement round-trips quotes and backslashes", () => {
  const settings = loadSettings(edit((v) => (v.messages.ask_chase.body = "Don't \\ retry")));
  const sql = statement(settings);
  const literal = /^select public\.assignment_settings_apply\('(.*)'::jsonb\);\n?$/s.exec(sql);
  assert.ok(literal, sql);
  assert.deepEqual(JSON.parse(literal[1].replaceAll("''", "'")), settings);
});

test("an invalid file exits non-zero and prints nothing on stdout", () => {
  const file = join(mkdtempSync(join(tmpdir(), "lifecycle-")), "bad.yaml");
  writeFileSync(
    file,
    edit((v) => delete v.lease),
  );
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "sync-lifecycle-settings.mjs"), file],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /lease/);
});
