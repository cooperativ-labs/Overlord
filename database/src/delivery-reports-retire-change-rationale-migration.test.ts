import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

const MIGRATION = '20261024130000_delivery_reports_retire_change_rationale.sql';
const sqliteMigration = readFileSync(
  new URL(`../sqlite/migrations/${MIGRATION}`, import.meta.url),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL(`../postgres/migrations/${MIGRATION}`, import.meta.url),
  'utf8'
);

function payload(presentation: Record<string, unknown>): string {
  return JSON.stringify({
    changeRationales: [{ filePath: 'legacy.ts', why: 'inert history' }],
    deliveryReport: {
      schemaVersion: 1,
      agentReport: {
        humanActions: [],
        tradeoffsMade: [
          {
            id: 'tradeoff-1',
            decision: 'Keep',
            alternativesConsidered: [],
            rationale: 'agent',
            source: 'agent'
          }
        ],
        knownRisks: [],
        deferredWork: [],
        assumptions: []
      },
      presentation: { status: 'composed', markdown: 'Composed.', ...presentation }
    }
  });
}

test('strips only change_rationale presentation items and keeps order and history', () => {
  const db = new (loadBetterSqlite3())(':memory:');
  db.exec(`CREATE TABLE deliveries (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)`);
  const tradeoff = (id: string, source: string) => ({
    id,
    decision: id,
    alternativesConsidered: [],
    rationale: 'why',
    source
  });
  const insert = db.prepare(`INSERT INTO deliveries VALUES (?, ?)`);
  insert.run(
    'mixed',
    payload({
      tradeoffsMade: [
        tradeoff('a', 'agent'),
        tradeoff('r1', 'change_rationale'),
        tradeoff('b', 'agent'),
        tradeoff('r2', 'change_rationale')
      ],
      humanActions: [
        { id: 'h1', action: 'Run it', category: 'other', source: 'deterministic_rule' },
        { id: 'h2', action: 'Old', category: 'other', source: 'change_rationale' }
      ]
    })
  );
  insert.run('only-rationale', payload({ tradeoffsMade: [tradeoff('r', 'change_rationale')] }));
  const untouched = payload({ tradeoffsMade: [tradeoff('a', 'agent')], humanActions: [] });
  insert.run('clean', untouched);
  insert.run('not-json', 'not json');

  db.exec(sqliteMigration);

  const read = (id: string) =>
    (db.prepare(`SELECT payload_json FROM deliveries WHERE id = ?`).get(id) as {
      payload_json: string;
    }).payload_json;
  const mixed = JSON.parse(read('mixed'));
  assert.deepEqual(
    mixed.deliveryReport.presentation.tradeoffsMade.map((item: { id: string }) => item.id),
    ['a', 'b']
  );
  assert.deepEqual(
    mixed.deliveryReport.presentation.humanActions.map((item: { id: string }) => item.id),
    ['h1']
  );
  assert.equal(mixed.deliveryReport.presentation.markdown, 'Composed.');
  assert.equal(mixed.deliveryReport.agentReport.tradeoffsMade.length, 1);
  assert.equal(mixed.changeRationales.length, 1, 'legacy top-level history stays inert');
  assert.deepEqual(
    JSON.parse(read('only-rationale')).deliveryReport.presentation.tradeoffsMade,
    []
  );
  assert.equal(read('clean'), untouched);
  assert.equal(read('not-json'), 'not json');
});

test('PostgreSQL migration applies the same item filter', () => {
  assert.match(postgresMigration, /IS DISTINCT FROM 'change_rationale'/);
  assert.match(postgresMigration, /WITH ORDINALITY/);
  assert.match(postgresMigration, /\{deliveryReport,presentation,tradeoffsMade\}/);
  assert.match(postgresMigration, /\{deliveryReport,presentation,humanActions\}/);
  assert.doesNotMatch(postgresMigration, /changeRationales/);
});
