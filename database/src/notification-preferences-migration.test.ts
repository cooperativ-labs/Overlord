import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openInMemoryDatabase } from './connection.js';

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'sqlite',
  'migrations',
  '20260809130000_notification_preferences_transports.sql'
);

test('notification preference migration fans legacy modes out to every transport', () => {
  const db = openInMemoryDatabase();
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE notification_preferences;
    CREATE TABLE notification_preferences (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_id, category)
    );
  `);
  db.prepare(
    `INSERT INTO notification_preferences
       (id, profile_id, category, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    'question-pref',
    'profile-1',
    'agent_question',
    'silent',
    '2026-08-09T12:00:00.000Z',
    '2026-08-09T12:00:00.000Z'
  );
  db.prepare(
    `INSERT INTO notification_preferences
       (id, profile_id, category, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    'master-pref',
    'profile-1',
    'all',
    'off',
    '2026-08-09T12:00:00.000Z',
    '2026-08-09T12:00:00.000Z'
  );

  db.exec(readFileSync(migrationPath, 'utf8'));

  const rows = db
    .prepare(
      `SELECT type, transport, mode
         FROM notification_preferences
        WHERE profile_id = ?
        ORDER BY type, transport`
    )
    .all('profile-1') as Array<{ type: string; transport: string; mode: string }>;
  assert.deepEqual(rows, [
    { type: 'agent_question', transport: 'apns', mode: 'silent' },
    { type: 'agent_question', transport: 'in_app', mode: 'silent' },
    { type: 'agent_question', transport: 'realtime', mode: 'silent' },
    { type: 'all', transport: 'all', mode: 'off' }
  ]);
});
