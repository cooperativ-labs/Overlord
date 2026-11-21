import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toPostgresPlaceholders } from './client.js';

describe('toPostgresPlaceholders', () => {
  it('rewrites positional placeholders to $n', () => {
    assert.equal(
      toPostgresPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?'),
      'SELECT * FROM t WHERE a = $1 AND b = $2'
    );
  });

  it('leaves ? inside string literals untouched', () => {
    assert.equal(
      toPostgresPlaceholders(`SELECT '? literal' AS q WHERE a = ?`),
      `SELECT '? literal' AS q WHERE a = $1`
    );
  });

  it('rewrites placeholders after an apostrophe in a comment', () => {
    const sql = `SELECT o.id
       -- The objective's newest session, resolved once rather than once per column.
      WHERE o.state IN (?, ?) AND o.id = ?`;
    assert.equal(
      toPostgresPlaceholders(sql),
      `SELECT o.id
       -- The objective's newest session, resolved once rather than once per column.
      WHERE o.state IN ($1, $2) AND o.id = $3`
    );
  });

  it('leaves ? inside comments untouched', () => {
    assert.equal(
      toPostgresPlaceholders(`SELECT 1 -- what?\nWHERE a = ? /* the objective's row? */ AND b = ?`),
      `SELECT 1 -- what?\nWHERE a = $1 /* the objective's row? */ AND b = $2`
    );
  });

  it('does not treat comment markers inside a string as comments', () => {
    assert.equal(
      toPostgresPlaceholders(`SELECT '-- it''s ?' AS q /* not this */ WHERE a = ?`),
      `SELECT '-- it''s ?' AS q /* not this */ WHERE a = $1`
    );
  });
});
