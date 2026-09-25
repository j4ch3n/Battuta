import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseEnv } from './tasks-pool.psql.mjs';

test('direct DB test connection accepts only explicit loopback PostgreSQL URLs', () => {
  for (const host of ['127.0.0.1', '[::1]']) {
    const env = databaseEnv(`postgresql://admin:p%40ss@${host}:54322/postgres`);
    assert.equal(env.PGHOST, host.replace(/^\[|\]$/g, ''));
    assert.equal(env.PGPORT, '54322');
    assert.equal(env.PGDATABASE, 'postgres');
    assert.equal(env.PGUSER, 'admin');
    assert.equal(env.PGPASSWORD, 'p@ss');
    assert.equal(env.PGPASSFILE, '/dev/null');
    assert.equal(env.PGCONNECT_TIMEOUT, '5');
    assert.equal(env.PGSSLMODE, 'disable');
    assert.deepEqual(Object.keys(env).sort(), [
      'PATH', 'PGCONNECT_TIMEOUT', 'PGDATABASE', 'PGHOST', 'PGPASSFILE', 'PGPASSWORD', 'PGPORT', 'PGSSLMODE', 'PGUSER',
    ]);
  }
  for (const value of [
    'postgres://admin:test@db.example/postgres', 'postgres://admin:test@localhost/postgres',
    'https://admin:test@127.0.0.1/postgres', 'postgres://admin:test@127.0.0.1/',
    'postgres://:test@127.0.0.1/postgres', 'postgres://admin:test@127.0.0.1/a/b',
    'postgres://admin:test@127.0.0.1/postgres?host=db.example',
    'postgres://admin:test@127.0.0.1/postgres#options',
  ]) assert.throws(() => databaseEnv(value));
});

test('direct DB test connection rejects missing and empty passwords', () => {
  for (const protocol of ['postgres', 'postgresql']) {
    for (const host of ['127.0.0.1', '[::1]']) {
      for (const userinfo of ['admin', 'admin:']) {
        assert.throws(() => databaseEnv(`${protocol}://${userinfo}@${host}/postgres`),
          /explicit nonempty test database password required/);
      }
    }
  }
});

test('psql child environment pins the password file and excludes ambient PG variables', () => {
  const ambient = {
    PGPASSFILE: 'ambient-password-file', PGPASSWORD: 'ambient-password',
    PGHOST: 'db.example', PGSERVICE: 'ambient-service',
    PGSERVICEFILE: 'ambient-service-file', PGOPTIONS: '-c search_path=ambient',
    PGARBITRARY: 'must-not-be-inherited',
  };
  const previous = Object.fromEntries(Object.keys(ambient).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, ambient);
    assert.deepEqual(databaseEnv('postgresql://admin:test@127.0.0.1/postgres'), {
      PATH: process.env.PATH,
      PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: 'postgres',
      PGUSER: 'admin', PGPASSWORD: 'test', PGPASSFILE: '/dev/null',
      PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable',
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
