import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import {
  formatObjectiveDisplayId,
  generateObjectiveDisplayKey,
  OBJECTIVE_DISPLAY_KEY_ALPHABET,
  OBJECTIVE_DISPLAY_KEY_LENGTH,
  parseObjectiveRef
} from './objective-display-key.js';
import { finalizeObjectivesDisplayKeySqlite } from './objective-display-key-migration-runtime.js';

const KEY_RE = new RegExp(`^[${OBJECTIVE_DISPLAY_KEY_ALPHABET}]{4,5}$`);

describe('generateObjectiveDisplayKey', () => {
  it('emits a lowercase Crockford key of the requested length', () => {
    const key = generateObjectiveDisplayKey({
      length: OBJECTIVE_DISPLAY_KEY_LENGTH,
      bytes: () => Buffer.from([0, 1, 31, 32])
    });
    assert.equal(key, '01z0');
    assert.equal(key.length, 4);
    assert.match(key, KEY_RE);
    assert.doesNotMatch(key, /[iloILOU]/);
  });

  it('maps every alphabet index and never uses i, l, o, or u', () => {
    assert.equal(OBJECTIVE_DISPLAY_KEY_ALPHABET.length, 32);
    assert.equal(OBJECTIVE_DISPLAY_KEY_ALPHABET, '0123456789abcdefghjkmnpqrstvwxyz');
    for (let i = 0; i < 64; i += 1) {
      const key = generateObjectiveDisplayKey({
        length: 4,
        bytes: () => Buffer.from([i, i + 1, i + 2, i + 3])
      });
      assert.match(key, KEY_RE);
      assert.doesNotMatch(key, /[iloILOU]/);
    }
  });
});

describe('parseObjectiveRef', () => {
  it('parses a UUID, a full display id, and a bare key', () => {
    assert.deepEqual(parseObjectiveRef('EA7DFDF9-5FEC-4696-A3A6-664012E6AEF6'), {
      kind: 'uuid',
      id: 'ea7dfdf9-5fec-4696-a3a6-664012e6aef6'
    });
    assert.deepEqual(parseObjectiveRef('coo:756.K7XM'), {
      kind: 'display_id',
      missionDisplayId: 'coo:756',
      displayKey: 'k7xm'
    });
    assert.deepEqual(parseObjectiveRef('my-team:12.n4w2'), {
      kind: 'display_id',
      missionDisplayId: 'my-team:12',
      displayKey: 'n4w2'
    });
    assert.deepEqual(parseObjectiveRef('Abcd'), {
      kind: 'display_key',
      displayKey: 'abcd'
    });
  });

  it('treats a bare mission id as a mistaken objective ref', () => {
    assert.deepEqual(parseObjectiveRef('coo:756'), {
      kind: 'mission_id',
      missionDisplayId: 'coo:756'
    });
  });

  it('rejects the wrong separators', () => {
    assert.deepEqual(parseObjectiveRef('coo:756:k7xm'), {
      kind: 'wrong_separator',
      separator: ':',
      ref: 'coo:756:k7xm'
    });
    assert.deepEqual(parseObjectiveRef('coo:756|k7xm'), {
      kind: 'wrong_separator',
      separator: '|',
      ref: 'coo:756|k7xm'
    });
    assert.deepEqual(parseObjectiveRef('coo:756-k7xm'), {
      kind: 'wrong_separator',
      separator: '-',
      ref: 'coo:756-k7xm'
    });
  });

  it('formats the public id with a dot', () => {
    assert.equal(
      formatObjectiveDisplayId({ missionDisplayId: 'coo:756', displayKey: 'k7xm' }),
      'coo:756.k7xm'
    );
  });
});

describe('finalizeObjectivesDisplayKeySqlite', () => {
  it('backfills blank keys including deleted rows and creates the unique live index', () => {
    const Database = loadBetterSqlite3();
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE objectives (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        display_key TEXT NOT NULL DEFAULT '',
        deleted_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare(
      `INSERT INTO objectives (id, mission_id, display_key, deleted_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    insert.run('live-a', 'mission-1', '', null, '2026-08-17T10:00:00.000Z');
    insert.run('live-b', 'mission-1', '', null, '2026-08-17T10:00:01.000Z');
    insert.run(
      'deleted-a',
      'mission-1',
      '',
      '2026-08-17T10:00:02.000Z',
      '2026-08-17T09:00:00.000Z'
    );
    insert.run('kept', 'mission-1', 'k7xm', null, '2026-08-17T10:00:03.000Z');
    insert.run('other-mission', 'mission-2', '', null, '2026-08-17T10:00:04.000Z');

    finalizeObjectivesDisplayKeySqlite(db);

    const rows = db
      .prepare(`SELECT id, mission_id, display_key FROM objectives ORDER BY created_at ASC, id ASC`)
      .all() as Array<{ id: string; mission_id: string; display_key: string }>;
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.match(row.display_key, KEY_RE);
    }
    assert.equal(rows.find(row => row.id === 'kept')?.display_key, 'k7xm');

    const missionOneKeys = rows
      .filter(row => row.mission_id === 'mission-1')
      .map(row => row.display_key);
    assert.equal(new Set(missionOneKeys).size, missionOneKeys.length);

    const index = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_objectives_mission_display_key'`
      )
      .get() as { name: string } | undefined;
    assert.equal(index?.name, 'idx_objectives_mission_display_key');

    assert.throws(() => {
      insert.run('collide', 'mission-1', 'k7xm', null, '2026-08-17T11:00:00.000Z');
    });
  });
});
