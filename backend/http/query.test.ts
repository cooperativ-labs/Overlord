import type { Request } from 'express';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError } from '../errors.ts';

import {
  optionalString,
  parseSeqCursor,
  queryCursor,
  queryEnum,
  queryFlag,
  queryString
} from './query.ts';

const req = (value: unknown) => ({ query: { value } }) as Pick<Request, 'query'>;

describe('query readers', () => {
  it('normalizes strings and preserves raw scalar semantics when requested', () => {
    assert.equal(queryString(req(' value '), 'value'), 'value');
    for (const value of [undefined, null, '', '  ', {}, 3, [null, 'second']]) {
      assert.equal(queryString(req(value), 'value'), null);
    }
    assert.equal(queryString(req([' first ', 'second']), 'value'), 'first');
    assert.equal(queryString(req(['first']), 'value', { first: false }), null);
    assert.equal(queryString(req('  '), 'value', { trim: false }), '  ');
    assert.equal(queryString(req(''), 'value', { trim: false }), '');
    assert.equal(optionalString(['value']), null);
    assert.equal(optionalString(' value '), 'value');
  });

  it('keeps bare flags on and recognizes only explicit false values', () => {
    for (const value of ['', ' ', '1', 'yes', ['true', 'false']]) {
      assert.equal(queryFlag(req(value), 'value'), true);
    }
    for (const value of [undefined, null, {}, '0', ' FALSE ', ['false', 'true']]) {
      assert.equal(queryFlag(req(value), 'value'), false);
    }
  });

  it('keeps cursor flooring, numeric syntax and first-value behavior', () => {
    for (const [value, expected] of [
      [' 2.9 ', 2],
      ['1e2', 100],
      ['0x10', 16],
      [['3', '4'], 3]
    ] as const) {
      assert.equal(queryCursor(req(value), 'value'), expected);
      assert.equal(parseSeqCursor(value), expected);
    }
    for (const value of [undefined, '', ' ', '-1', 'NaN', 'Infinity', {}, ['no', '3']]) {
      assert.equal(queryCursor(req(value), 'value'), null);
    }
  });

  it('defaults enums only when absent and preserves the existing validation message', () => {
    const values = ['active', 'archived', 'all'] as const;
    assert.equal(queryEnum(req(undefined), 'value', values, 'active'), 'active');
    assert.equal(queryEnum(req(['archived', 'invalid']), 'value', values, 'active'), 'archived');
    for (const value of ['', ' active ', 'invalid', null, {}]) {
      assert.throws(
        () => queryEnum(req(value), 'value', values, 'active'),
        error =>
          error instanceof ApiError &&
          error.status === 400 &&
          error.message === 'value must be one of: active, archived, all'
      );
    }
  });
});
