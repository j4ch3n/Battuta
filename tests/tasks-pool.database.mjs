import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { databaseEnv, databaseSession } from './tasks-pool.psql.mjs';

// Never load application credentials. Opt-in is an assertion of DB isolation.
const enabled = process.env.TASKS_POOL_TEST_ISOLATED === '1';
const url = process.env.TASKS_POOL_TEST_URL;
const secret = process.env.TASKS_POOL_TEST_SECRET_KEY;
const databaseUrl = process.env.TASKS_POOL_TEST_DATABASE_URL;
if (enabled) {
  assert.ok(url && secret, 'explicit test URL and secret required');
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', '[::1]'].includes(parsed.hostname), 'only loopback databases allowed');
  assert.equal(parsed.protocol, 'http:');
  assert.equal(parsed.pathname, '/');
  assert.ok(!parsed.username && !parsed.password && !parsed.search && !parsed.hash);
  if (databaseUrl) databaseEnv(databaseUrl);
}

function client() {
  return async (name, args) => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
    return body;
  };
}

test('durable task pool RPCs (isolated local Supabase only)', {
  skip: !enabled && 'requires explicit isolated local database opt-in',
}, async (t) => {
  const rpc = client();
  const prefix = randomUUID();
  const worker = (name) => `${prefix}-${name}`;
  const payload = (name, role = worker(name)) => ({
    p_key: worker(name), p_project: 'task-pool-test', p_ticket_id: 'FIS-40',
    p_role: role, p_instruction: `test ${name}`,
  });
  const delegate = (args) => rpc('delegate_task', args);
  const claim = (id, role) => rpc('claim_task', { p_worker_id: id, p_role: role });
  const terminal = (name, id, task) => rpc(name, {
    p_worker_id: id, p_task_id: task.id,
    ...(name === 'fail_task' ? { p_reason: 'not persisted' } : {}),
  });

  await t.test('concurrent idempotency and conflicts in every payload field', async () => {
    const args = payload('idempotency');
    const tasks = await Promise.all(Array.from({ length: 12 }, () => delegate(args)));
    assert.equal(new Set(tasks.map((task) => task.id)).size, 1);
    assert.equal(tasks[0].status, 'queued');
    assert.equal(tasks[0].claimed_by, null);
    assert.ok(tasks[0].created_at);
    for (const field of ['claimed_at', 'completed_at', 'failed_at']) {
      assert.equal(tasks[0][field], null);
    }
    for (const field of ['p_project', 'p_ticket_id', 'p_role', 'p_instruction']) {
      await assert.rejects(delegate({ ...args, [field]: 'changed' }), /idempotency key reused/);
    }
    const task = await claim(worker('idem-owner'), args.p_role);
    const done = await terminal('complete_task', worker('idem-owner'), task);
    assert.deepEqual(await delegate(args), done);
  });

  await t.test('concurrent conflicting submissions preserve exactly one payload', async () => {
    const args = payload('conflicting-race');
    const candidates = [args, { ...args, p_instruction: 'different instruction' }];
    const results = await Promise.allSettled(candidates.map(delegate));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    assert.match(results[1 - winner].reason.message, /idempotency key reused/);
    assert.deepEqual(await delegate(candidates[winner]), results[winner].value);
    const id = worker('conflict-owner');
    const task = await claim(id, args.p_role);
    assert.equal(task.instruction, candidates[winner].p_instruction);
    await terminal('complete_task', id, task);
    assert.equal(await claim(id, args.p_role), null);
  });

  await t.test('oldest compatible task and empty queue', async () => {
    const role = worker('ordering');
    const first = await delegate(payload('first', role));
    const second = await delegate(payload('second', role));
    const expected = [first, second].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    await delegate(payload('other-role'));
    for (const task of expected) {
      const owned = await claim(worker('ordered'), role);
      assert.equal(owned.id, task.id);
      await terminal('complete_task', worker('ordered'), owned);
    }
    assert.equal(await claim(worker('ordered'), role), null);
  });

  await t.test('concurrent distinct workers never claim the same task', async () => {
    const role = worker('parallel');
    const queued = await Promise.all(Array.from({ length: 12 }, (_, i) => delegate(payload(`parallel-${i}`, role))));
    const claims = await Promise.all(Array.from({ length: 20 }, (_, i) => claim(worker(`parallel-worker-${i}`), role)));
    const owned = claims.filter(Boolean);
    assert.equal(owned.length, queued.length);
    assert.deepEqual(new Set(owned.map((task) => task.id)), new Set(queued.map((task) => task.id)));
    await Promise.all(owned.map((task) => terminal('complete_task', task.claimed_by, task)));
  });

  await t.test('claim skips the oldest row while a separate transaction holds its lock', {
    skip: !databaseUrl && 'requires psql and TASKS_POOL_TEST_DATABASE_URL (isolated local admin)',
  }, async () => {
    const role = worker('held-lock');
    const queued = [await delegate(payload('held-first', role)), await delegate(payload('held-next', role))];
    const session = databaseSession(databaseUrl);
    try {
      // IDs are server-returned UUIDs, not arbitrary SQL input.
      for (const task of queued) assert.match(task.id, /^[0-9a-f-]{36}$/i);
      const oldestId = await session.query(`
        begin;
        set local statement_timeout = '10s';
        set local idle_in_transaction_session_timeout = '60s';
        select id from public.tasks_pool
        where id in ('${queued[0].id}', '${queued[1].id}') and status = 'queued'
        order by created_at, id limit 1 for update;
      `);
      assert.ok(queued.some((task) => task.id === oldestId), 'lock acknowledged on a fixture in the same database');
      const next = queued.find((task) => task.id !== oldestId);
      const id = worker('skip-lock-owner');
      // Await the RPC while the lock is STILL held. Without SKIP LOCKED this
      // fails/times out, rather than passing due to fortunate request timing.
      const claimed = await claim(id, role);
      assert.equal(claimed.id, next.id);
      assert.equal(claimed.claimed_by, id);
      assert.equal(await session.query(`select status from public.tasks_pool where id = '${oldestId}';`), 'queued');
      await session.query('rollback;');
      const oldest = await claim(worker('released-lock-owner'), role);
      assert.equal(oldest.id, oldestId);
      await terminal('complete_task', id, claimed);
      await terminal('complete_task', worker('released-lock-owner'), oldest);
    } finally {
      await session.close();
    }
  });

  await t.test('database roles and effective privileges match the shared-service trust boundary', {
    skip: !databaseUrl && 'requires psql and TASKS_POOL_TEST_DATABASE_URL (admin able to SET ROLE)',
  }, async () => {
    const session = databaseSession(databaseUrl);
    try {
      const sql = await readFile(new URL('./tasks-pool.privileges.sql', import.meta.url), 'utf8');
      await session.query(sql);
    } finally {
      await session.close();
    }
  });

  await t.test('stable worker recovers across fresh clients, concurrent calls and role changes', async () => {
    const role = worker('recovery');
    await delegate(payload('recover-1', role));
    await delegate(payload('recover-2', role));
    const id = worker('stable');
    const claims = await Promise.all(Array.from({ length: 12 }, () => claim(id, role)));
    assert.equal(new Set(claims.map((task) => task.id)).size, 1);
    // A new client represents a disposable Pi session; no session state is sent.
    assert.deepEqual(await client()('claim_task', { p_worker_id: id, p_role: 'different-role' }), claims[0]);
    await terminal('complete_task', id, claims[0]);
    const next = await claim(id, role);
    assert.notEqual(next.id, claims[0].id);
    await terminal('fail_task', id, next);
    assert.equal(await claim(id, role), null);
  });

  await t.test('ownership, timestamps and irreversible terminal transitions', async () => {
    for (const action of ['complete_task', 'fail_task']) {
      const args = payload(action);
      const queued = await delegate(args);
      const id = worker(`owner-${action}`);
      for (const operation of ['complete_task', 'fail_task']) {
        await assert.rejects(terminal(operation, id, queued), /not claimed by this worker/);
      }
      const task = await claim(id, args.p_role);
      assert.equal(task.status, 'claimed');
      assert.equal(task.claimed_by, id);
      assert.ok(task.claimed_at);
      assert.equal(task.completed_at, null);
      assert.equal(task.failed_at, null);
      for (const operation of ['complete_task', 'fail_task']) {
        await assert.rejects(terminal(operation, worker('intruder'), task), /not claimed by this worker/);
      }
      const ended = await terminal(action, id, task);
      assert.equal(ended.status, action === 'complete_task' ? 'completed' : 'failed');
      assert.ok(ended[action === 'complete_task' ? 'completed_at' : 'failed_at']);
      assert.equal(ended[action === 'complete_task' ? 'failed_at' : 'completed_at'], null);
      assert.equal(ended.claimed_at, task.claimed_at);
      assert.equal(ended.claimed_by, id);
      assert.ok(!Object.keys(ended).some((key) => key.includes('reason')));
      assert.deepEqual(await delegate(args), ended);
      for (const operation of ['complete_task', 'fail_task']) {
        await assert.rejects(terminal(operation, id, task), /not claimed by this worker/);
      }
      assert.equal(await claim(id, args.p_role), null);
    }
    for (const operation of ['complete_task', 'fail_task']) {
      await assert.rejects(terminal(operation, worker('missing'), { id: randomUUID() }), /not claimed by this worker/);
    }
  });

  await t.test('competing terminal transitions have exactly one winner', async () => {
    const args = payload('terminal-race');
    await delegate(args);
    const id = worker('terminal-race-owner');
    const task = await claim(id, args.p_role);
    const results = await Promise.allSettled([
      terminal('complete_task', id, task), terminal('fail_task', id, task),
    ]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.match(losers[0].reason.message, /not claimed by this worker/);
    assert.deepEqual(await delegate(args), winners[0].value);
    assert.equal(await claim(id, args.p_role), null);
  });

  await t.test('defaults and invalid inputs', async () => {
    const args = payload('default');
    delete args.p_role;
    const queued = await delegate(args);
    assert.equal(queued.role, 'executor');
    const id = worker('default');
    const task = await rpc('claim_task', { p_worker_id: id });
    assert.equal(task.id, queued.id, 'database must have no pre-existing executor tasks');
    await terminal('complete_task', id, task);
    for (const field of ['p_key', 'p_project', 'p_ticket_id', 'p_role', 'p_instruction']) {
      for (const value of [null, '', '   ']) {
        await assert.rejects(delegate({ ...payload(`invalid-${field}-${value}`), [field]: value }));
      }
    }
    const missingInstruction = payload('missing-instruction');
    delete missingInstruction.p_instruction;
    await assert.rejects(delegate(missingInstruction));
    for (const value of [null, '', '   ']) {
      await assert.rejects(claim(value, 'executor'), /must be nonempty/);
      await assert.rejects(claim(worker('invalid'), value), /must be nonempty/);
    }
  });
});
