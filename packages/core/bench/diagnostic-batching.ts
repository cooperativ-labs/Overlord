// Gated persistence experiment for coo:1127.0bj3. It compares the current
// awaited per-observation diagnostic append with a prototype durable journal
// admission plus ordered bulk materialization. The journal tables exist only in
// the disposable benchmark database; no production schema uses them.
//
//   node --import tsx packages/core/bench/diagnostic-batching.ts [out.json]
//   TEST_DATABASE_URL=... (or scripts/with-test-db.mjs) adds the Postgres runs.
//   CHAT_BATCH_EVAL_REPEATS (default 7) and CHAT_BATCH_EVAL_RTT_MS (default 0,2,5)
import {
  createPostgresClient,
  createSqliteClient,
  type DatabaseClient,
  migrateDatabase,
  migratePostgres,
  openDatabase
} from '@overlord/database';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conversations } from '../service/chat/conversations.js';
import { appendDiagnostic, diagnosticJson } from '../service/chat/diagnostics.js';
import { ChatStore } from '../service/chat/store.js';

type Step = { kind: string; bytes: number; domain: boolean };

/** Ordered workload derived from audit thread A's content-free kind counts and sizes. */
function liveWorkload(): Step[] {
  const metrics = JSON.parse(
    readFileSync(
      new URL(
        '../../../docs/reviews/chat-diagnostics-audit-2026-10-07.metrics.json',
        import.meta.url
      ),
      'utf8'
    )
  ) as {
    threads: {
      exchanges: { chunks: number }[];
      allRequests: { requestBytes: number }[];
    }[];
  };
  const a = metrics.threads[0]!;
  const steps: Step[] = [];
  const push = (kind: string, bytes: number, domain = false) => steps.push({ kind, bytes, domain });
  let http = 50,
    deltas = 35;
  a.exchanges.forEach((exchange, i) => {
    push('http.exchange', 884);
    http--;
    push('provider.request', a.allRequests[i]!.requestBytes);
    for (let c = 0; c < exchange.chunks; c++) {
      push('provider.chunk', 1434);
      if (i === a.exchanges.length - 1 && deltas > 0) {
        push('message.delta', 1675, true);
        deltas--;
      }
    }
    push('provider.completed', 320);
    push('provider.stream_closed', 220);
    if (i < 27) {
      push('tool.updated', 4385, true);
      push('tool.updated', 4385, true);
      if (i < 26) push('tool.response', 6306);
      push('tool.updated', 4385, true);
      push('http.exchange', 884);
      http--;
    }
  });
  while (http-- > 0) push('http.exchange', 884);
  return steps;
}

/** Incompressible payloads so TOAST/page compression cannot flatter large rows. */
function payload(step: Step) {
  return {
    kind: step.kind,
    blob: randomBytes(Math.max(1, Math.floor(step.bytes * 0.75))).toString('base64')
  };
}

const JOURNAL_DDL = {
  sqlite: `CREATE TABLE IF NOT EXISTS chat_diagnostic_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    admission_key TEXT NOT NULL UNIQUE,
    run_id TEXT, attempt_id TEXT, kind TEXT NOT NULL,
    payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  postgres: `CREATE TABLE IF NOT EXISTS chat_diagnostic_journal (
    id bigserial PRIMARY KEY,
    thread_id text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    admission_key text NOT NULL UNIQUE,
    run_id text, attempt_id text, kind text NOT NULL,
    payload_json jsonb NOT NULL, created_at timestamptz NOT NULL)`
};

async function admit(db: DatabaseClient, threadId: string, key: string, step: Step) {
  // Idempotent durable admission: a retried observation reuses its key.
  await db.run(
    `INSERT INTO chat_diagnostic_journal (thread_id, admission_key, run_id, attempt_id, kind, payload_json, created_at)
     VALUES (?, ?, NULL, NULL, ?, ?, ?) ON CONFLICT (admission_key) DO NOTHING`,
    [threadId, key, step.kind, diagnosticJson(payload(step)), new Date().toISOString()]
  );
}

/** Caller holds the thread lock. Assigns contiguous seq in journal order. */
async function materialize(db: DatabaseClient, threadId: string): Promise<number> {
  const high = await db.get<{ id: number | string | null }>(
    'SELECT MAX(id) AS id FROM chat_diagnostic_journal WHERE thread_id = ?',
    [threadId]
  );
  if (high?.id === null || high?.id === undefined) return 0;
  const moved = await db.run(
    `INSERT INTO chat_diagnostics (thread_id, seq, kind, payload_json, created_at, run_id, attempt_id)
     SELECT thread_id,
            (SELECT COALESCE(MAX(seq), 0) FROM chat_diagnostics WHERE thread_id = ?) + ROW_NUMBER() OVER (ORDER BY id),
            kind, payload_json, created_at, run_id, attempt_id
       FROM chat_diagnostic_journal WHERE thread_id = ? AND id <= ? ORDER BY id`,
    [threadId, threadId, high.id]
  );
  await db.run('DELETE FROM chat_diagnostic_journal WHERE thread_id = ? AND id <= ?', [
    threadId,
    high.id
  ]);
  return moved.changes;
}

const lock = (db: DatabaseClient, id: string) =>
  db.run('UPDATE chat_threads SET id = id WHERE id = ?', [id]);

/** Postgres statements issued (each is one client/server round trip). */
let statements = 0;

type Strategy = 'current' | 'journal-ordered' | 'journal-bulk32';
type Sample = {
  strategy: Strategy;
  rows: number;
  criticalMs: number;
  standaloneMs: number[];
  domainMs: number[];
  backgroundMs: number;
  totalMs: number;
  statements: number;
};

async function runOnce(
  db: DatabaseClient,
  conversations: Conversations,
  strategy: Strategy,
  steps: Step[]
): Promise<Sample> {
  const owner = { profileId: 'owner', organizationId: 'org' };
  const threadId = (await conversations.create(owner)).thread.id;
  const store = new ChatStore(db);
  const standaloneMs: number[] = [],
    domainMs: number[] = [];
  let backgroundMs = 0,
    pending = 0,
    n = 0;
  statements = 0;
  const started = performance.now();
  for (const step of steps) {
    const key = `${threadId}:${n++}`;
    const t0 = performance.now();
    if (!step.domain) {
      if (strategy === 'current') await store.diagnostic(threadId, step.kind, payload(step));
      else {
        await admit(db, threadId, key, step);
        pending++;
      }
      standaloneMs.push(performance.now() - t0);
    } else {
      // Domain events already commit their diagnostic in the event transaction.
      await db.transaction(async tx => {
        await lock(tx, threadId);
        if (strategy === 'journal-ordered' && pending) {
          await materialize(tx, threadId);
          pending = 0;
        }
        if (strategy === 'journal-bulk32') await admit(tx, threadId, key, step);
        else
          await appendDiagnostic(tx, threadId, step.kind, payload(step), new Date().toISOString());
      });
      if (strategy === 'journal-bulk32') pending++;
      domainMs.push(performance.now() - t0);
    }
    if (strategy === 'journal-bulk32' && pending >= 32) {
      // Optimistic upper bound: an off-path materializer that ignores ordering hazards.
      const b0 = performance.now();
      await db.transaction(async tx => {
        await lock(tx, threadId);
        await materialize(tx, threadId);
      });
      backgroundMs += performance.now() - b0;
      pending = 0;
    }
  }
  if (strategy !== 'current') {
    const b0 = performance.now();
    await db.transaction(async tx => {
      await lock(tx, threadId);
      await materialize(tx, threadId);
    });
    backgroundMs += performance.now() - b0;
  }
  const totalMs = performance.now() - started;
  const issued = statements;
  const rows = await db.get<{ n: number | string; max: number | string }>(
    'SELECT COUNT(*) AS n, MAX(seq) AS max FROM chat_diagnostics WHERE thread_id = ?',
    [threadId]
  );
  if (Number(rows?.n) !== steps.length || Number(rows?.max) !== steps.length)
    throw new Error(
      `${strategy}: expected ${steps.length} contiguous rows, got ${JSON.stringify(rows)}`
    );
  const ordered = await db.all<{ kind: string }>(
    'SELECT kind FROM chat_diagnostics WHERE thread_id = ? ORDER BY seq',
    [threadId]
  );
  if (strategy !== 'journal-bulk32' && ordered.some((r, i) => r.kind !== steps[i]!.kind))
    throw new Error(`${strategy}: diagnostic order diverged from observation order`);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    strategy,
    rows: steps.length,
    criticalMs: sum(standaloneMs) + sum(domainMs),
    standaloneMs,
    domainMs,
    backgroundMs,
    totalMs,
    statements: issued
  };
}

/** Crash after admission, before materialization: restart recovers once, idempotently. */
async function recoveryCheck(db: DatabaseClient, conversations: Conversations, steps: Step[]) {
  const threadId = (await conversations.create({ profileId: 'owner', organizationId: 'org' }))
    .thread.id;
  const slice = steps.slice(0, 40);
  for (let i = 0; i < slice.length; i++) await admit(db, threadId, `${threadId}:${i}`, slice[i]!);
  // Replayed admissions after an ambiguous crash are deduplicated by key.
  for (let i = 30; i < slice.length; i++) await admit(db, threadId, `${threadId}:${i}`, slice[i]!);
  const t0 = performance.now();
  const moved = await db.transaction(async tx => {
    await lock(tx, threadId);
    return materialize(tx, threadId);
  });
  const recoverMs = performance.now() - t0;
  const again = await db.transaction(async tx => {
    await lock(tx, threadId);
    return materialize(tx, threadId);
  });
  if (moved !== 40 || again !== 0) throw new Error(`recovery moved ${moved}, then ${again}`);
  await db.run('DELETE FROM chat_threads WHERE id = ?', [threadId]);
  const left = await db.get<{ n: number | string }>(
    'SELECT (SELECT COUNT(*) FROM chat_diagnostic_journal WHERE thread_id = ?) + (SELECT COUNT(*) FROM chat_diagnostics WHERE thread_id = ?) AS n',
    [threadId, threadId]
  );
  if (Number(left?.n) !== 0) throw new Error('thread deletion did not cascade journal rows');
  return { rows: 40, duplicatesIgnored: 10, recoverMs };
}

/** TCP relay adding a fixed one-way delay per direction, preserving byte order. */
async function latencyProxy(target: URL, oneWayMs: number) {
  const server = net.createServer(client => {
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    const relay = (from: net.Socket, to: net.Socket) => {
      let tail = 0;
      from.on('data', chunk => {
        const at = Math.max(performance.now() + oneWayMs, tail);
        tail = at;
        setTimeout(() => to.write(chunk), Math.max(0, at - performance.now()));
      });
      from.on('close', () => setTimeout(() => to.destroy(), oneWayMs + 1));
      from.on('error', () => to.destroy());
    };
    relay(client, upstream);
    relay(upstream, client);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const url = new URL(target.toString());
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return { url: url.toString(), close: () => new Promise<void>(r => server.close(() => r())) };
}

async function seed(db: DatabaseClient) {
  const stamp = new Date().toISOString();
  await db.run(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('owner', 'Owner', 'owner@test.invalid', ${db.dialect === 'sqlite' ? '0' : 'FALSE'}, ?, ?)`,
    [stamp, stamp]
  );
  await db.run(
    "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)",
    [stamp, stamp]
  );
  await db.run(
    "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'Ws', 'hosted', ?, ?)",
    [stamp, stamp]
  );
  await db.run(
    "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES ('member', 'ws', 'owner', 'owner', 'active', ?, ?)",
    [stamp, stamp]
  );
  await db.run(JOURNAL_DDL[db.dialect]);
}

async function withAdapter<T>(
  adapter: 'sqlite' | 'postgres',
  oneWayMs: number,
  fn: (db: DatabaseClient) => Promise<T>
): Promise<T> {
  if (adapter === 'sqlite') {
    const dir = mkdtempSync(join(tmpdir(), 'overlord-batch-eval-'));
    const raw = openDatabase({ databasePath: join(dir, 'bench.sqlite') }); // WAL, on disk
    migrateDatabase(raw);
    const db = createSqliteClient(raw);
    try {
      await seed(db);
      return await fn(db);
    } finally {
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const { default: pg } = await import('pg');
  const query = pg.Client.prototype.query as (...args: unknown[]) => unknown;
  if (!(query as { counted?: boolean }).counted) {
    const counted = function (this: unknown, ...args: unknown[]) {
      statements++;
      return query.apply(this, args);
    };
    (counted as { counted?: boolean }).counted = true;
    pg.Client.prototype.query = counted as typeof pg.Client.prototype.query;
  }
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `chat_batch_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const proxy = oneWayMs
    ? await latencyProxy(new URL(process.env.TEST_DATABASE_URL!), oneWayMs)
    : null;
  const pool = new pg.Pool({
    connectionString: proxy?.url ?? process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 4
  });
  const db = createPostgresClient(pool, { ownsPool: true });
  try {
    await migratePostgres(db);
    await seed(db);
    return await fn(db);
  } finally {
    await db.close();
    await proxy?.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n: s.length,
    min: r(s[0]!),
    p50: r(at(0.5)),
    p95: r(at(0.95)),
    max: r(s.at(-1)!),
    mean: r(mean),
    sd: r(sd)
  };
};

async function main() {
  const repeats = Number(process.env.CHAT_BATCH_EVAL_REPEATS ?? 7);
  const rtts = (process.env.CHAT_BATCH_EVAL_RTT_MS ?? '0,2,5').split(',').map(Number);
  const steps = liveWorkload();
  const configs: { adapter: 'sqlite' | 'postgres'; rttMs: number }[] = [
    { adapter: 'sqlite', rttMs: 0 }
  ];
  if (process.env.TEST_DATABASE_URL)
    for (const rttMs of rtts) configs.push({ adapter: 'postgres', rttMs });
  const strategies: Strategy[] = ['current', 'journal-ordered', 'journal-bulk32'];
  const results = [];
  for (const { adapter, rttMs } of configs) {
    const out = await withAdapter(adapter, rttMs / 2, async db => {
      const conversations = new Conversations(db);
      const samples: Sample[] = [];
      for (let rep = -1; rep < repeats; rep++) {
        // Rotate strategy order per repetition; repetition -1 warms and is discarded.
        const order = strategies.map((_, i) => strategies[(i + rep + 3) % 3]!);
        for (const strategy of order) {
          const sample = await runOnce(db, conversations, strategy, steps);
          if (rep >= 0) samples.push(sample);
        }
      }
      const recovery = await recoveryCheck(db, conversations, steps);
      return { samples, recovery };
    });
    const by = (s: Strategy) => out.samples.filter(x => x.strategy === s);
    results.push({
      adapter,
      injectedRttMs: rttMs,
      recovery: out.recovery,
      strategies: Object.fromEntries(
        strategies.map(s => [
          s,
          {
            criticalPathMs: stats(by(s).map(x => x.criticalMs)),
            backgroundMaterializeMs: stats(by(s).map(x => x.backgroundMs)),
            endToEndMs: stats(by(s).map(x => x.totalMs)),
            statementsPerRun: adapter === 'postgres' ? stats(by(s).map(x => x.statements)) : null,
            standalonePerRowMs: stats(by(s).flatMap(x => x.standaloneMs)),
            domainPerEventMs: stats(by(s).flatMap(x => x.domainMs))
          }
        ])
      )
    });
    process.stderr.write(`done ${adapter} rtt=${rttMs}\n`);
  }
  const report = {
    objective: 'coo:1127.0bj3',
    workload: {
      source: 'audit thread A kind counts, per-exchange chunk counts and request sizes',
      rows: steps.length,
      standaloneRows: steps.filter(s => !s.domain).length,
      domainEventRows: steps.filter(s => s.domain).length,
      payloadBytesApprox: steps.reduce((a, s) => a + s.bytes, 0)
    },
    repeats,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    results
  };
  const json = JSON.stringify(report, null, 2);
  if (process.argv[2]) writeFileSync(process.argv[2], json + '\n');
  else process.stdout.write(json + '\n');
}

await main();
