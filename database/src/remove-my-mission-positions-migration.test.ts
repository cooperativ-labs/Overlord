import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

const migration = readFileSync(
  new URL('../sqlite/migrations/20261008100000_remove_my_mission_positions.sql', import.meta.url),
  'utf8'
);

test('retiring personal order preserves missions, project order and assignments', () => {
  const db = new (loadBetterSqlite3())(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE missions (
        id TEXT PRIMARY KEY, board_position REAL, assigned_workspace_user_id TEXT,
        status_id TEXT, status_type TEXT
      );
      CREATE TABLE my_mission_positions (
        mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE, position REAL
      );
      CREATE INDEX idx_personal_order ON my_mission_positions(position);
      INSERT INTO missions VALUES ('m1', 200, 'u1', 'review-1', 'review');
      INSERT INTO my_mission_positions VALUES ('m1', 100);
    `);
    const before = db.prepare('SELECT * FROM missions').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM missions').all(), before);
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'my_mission_positions'").get(),
      undefined
    );
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_personal_order'").get(),
      undefined
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    db.exec(migration);
  } finally {
    db.close();
  }
});

test(
  'Postgres retires personal order while preserving its referenced missions',
  {
    skip: !process.env.TEST_DATABASE_URL
  },
  async () => {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const client = await pool.connect();
    const schema = `ovld_retire_personal_order_${randomUUID().replace(/-/g, '')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`
      CREATE TABLE missions (
        id TEXT PRIMARY KEY, board_position REAL, assigned_workspace_user_id TEXT,
        status_id TEXT, status_type TEXT
      );
      CREATE TABLE my_mission_positions (
        mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE, position REAL
      );
      INSERT INTO missions VALUES ('m1', 200, 'u1', 'review-1', 'review');
      INSERT INTO my_mission_positions VALUES ('m1', 100);
    `);
      const before = (await client.query('SELECT * FROM missions')).rows;
      const sql = readFileSync(
        new URL(
          '../postgres/migrations/20261008100000_remove_my_mission_positions.sql',
          import.meta.url
        ),
        'utf8'
      );
      await client.query(sql);
      assert.deepEqual((await client.query('SELECT * FROM missions')).rows, before);
      assert.equal(
        (await client.query("SELECT to_regclass('my_mission_positions') AS table_name")).rows[0]
          .table_name,
        null
      );
      await client.query(sql);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  }
);
