import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

// Deliberately do not inherit PG*, application credentials, or psql startup files.
export function databaseEnv(value) {
  const parsed = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(['127.0.0.1', '[::1]'].includes(parsed.hostname), 'only loopback databases allowed');
  assert.ok(!parsed.search && !parsed.hash, 'connection options are not allowed');
  const database = decodeURIComponent(parsed.pathname.slice(1));
  assert.ok(database && !database.includes('/'), 'explicit database required');
  assert.ok(parsed.username, 'explicit database user required');
  assert.ok(parsed.password, 'explicit nonempty test database password required');
  return {
    PATH: process.env.PATH,
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: parsed.port || '5432', PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password),
    PGPASSFILE: '/dev/null',
    PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable',
  };
}

export function databaseSession(value) {
  const child = spawn('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    env: databaseEnv(value), stdio: ['pipe', 'pipe', 'pipe'],
  });
  let pending;
  let failure;
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
  const fail = (error) => {
    failure = error;
    pending?.reject(error);
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  const exited = new Promise((resolve) => child.on('close', (code) => {
    fail(new Error(`psql closed (${code}): ${stderr}`));
    resolve(code);
  }));
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (line === pending?.marker) pending.resolve(pending.lines.join('\n'));
    else pending?.lines.push(line);
  });
  return {
    async query(sql) {
      assert.ok(!pending, 'test session queries must be sequential');
      if (failure) throw failure;
      const marker = randomUUID();
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          pending = { marker, lines: [], resolve, reject };
          timer = setTimeout(() => {
            reject(new Error('test psql command timed out'));
            child.kill('SIGKILL');
          }, 20000);
          child.stdin.write(`${sql}\n\\echo ${marker}\n`);
        });
      } finally {
        clearTimeout(timer);
        pending = undefined;
      }
    },
    async close() {
      // Disconnect rolls back any test-local transaction, including on failure.
      child.kill('SIGKILL');
      await exited;
    },
  };
}
