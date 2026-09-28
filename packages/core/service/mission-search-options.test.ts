import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import { parseMissionSearchOptions } from './mission-search.js';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

function rejects400(fn: () => unknown, message: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'validation_error');
    assert.equal(error.message, message);
    return true;
  });
}

describe('parseMissionSearchOptions', () => {
  it('returns nulls and an undefined limit for an empty request', () => {
    for (const version of [1, 2, 3] as const) {
      assert.deepEqual(parseMissionSearchOptions({}, { version }), {
        query: null,
        projectId: null,
        projectIds: null,
        statusTypes: null,
        resourceKeys: null,
        dateField: null,
        from: null,
        to: null,
        limit: undefined,
        entityTypes: null,
        objectiveStates: null,
        matchesPerResult: null
      });
    }
  });

  it('keeps q verbatim and ignores non-string values', () => {
    assert.equal(
      parseMissionSearchOptions({ q: '  spaced  ' }, { version: 2 }).query,
      '  spaced  '
    );
    assert.equal(parseMissionSearchOptions({ q: ['a', 'b'] }, { version: 2 }).query, null);
  });

  it('parses limit with parseInt semantics and drops non-numeric values', () => {
    assert.equal(parseMissionSearchOptions({ limit: '10' }, { version: 2 }).limit, 10);
    assert.equal(parseMissionSearchOptions({ limit: '7abc' }, { version: 2 }).limit, 7);
    assert.equal(parseMissionSearchOptions({ limit: 'abc' }, { version: 2 }).limit, undefined);
  });

  it('splits CSV lists with trim and empty filtering; an empty value is an empty list', () => {
    const parsed = parseMissionSearchOptions(
      { statusTypes: ' execute, ,review,', resourceKeys: 'a, ,b' },
      { version: 3 }
    );
    assert.deepEqual(parsed.statusTypes, ['execute', 'review']);
    assert.deepEqual(parsed.resourceKeys, ['a', 'b']);
    assert.deepEqual(
      parseMissionSearchOptions({ statusTypes: '' }, { version: 2 }).statusTypes,
      []
    );
    assert.deepEqual(
      parseMissionSearchOptions({ resourceKeys: ' , ' }, { version: 2 }).resourceKeys,
      []
    );
  });

  it('falls back from resourceKeys to a single trimmed resourceKey', () => {
    assert.deepEqual(
      parseMissionSearchOptions({ resourceKey: ' repo ' }, { version: 2 }).resourceKeys,
      ['repo']
    );
    assert.equal(
      parseMissionSearchOptions({ resourceKey: '  ' }, { version: 2 }).resourceKeys,
      null
    );
    assert.deepEqual(
      parseMissionSearchOptions({ resourceKeys: 'x', resourceKey: 'y' }, { version: 2 })
        .resourceKeys,
      ['x']
    );
  });

  it('keeps non-blank from/to verbatim and nulls blank ones', () => {
    const parsed = parseMissionSearchOptions(
      { from: '2026-01-01T00:00:00Z', to: '   ' },
      { version: 2 }
    );
    assert.equal(parsed.from, '2026-01-01T00:00:00Z');
    assert.equal(parsed.to, null);
  });

  it('accepts only the closed dateField set, rejecting an empty value', () => {
    for (const dateField of ['createdAt', 'updatedAt', 'dueDatetime']) {
      assert.equal(parseMissionSearchOptions({ dateField }, { version: 3 }).dateField, dateField);
    }
    for (const version of [1, 2, 3] as const) {
      rejects400(
        () => parseMissionSearchOptions({ dateField: 'startedAt' }, { version }),
        'dateField must be createdAt, updatedAt, or dueDatetime'
      );
      rejects400(
        () => parseMissionSearchOptions({ dateField: '' }, { version }),
        'dateField must be createdAt, updatedAt, or dueDatetime'
      );
    }
  });

  it('v1 reads a single trimmed projectId and never projectIds', () => {
    const parsed = parseMissionSearchOptions(
      { projectId: `  ${PROJECT_A}  `, projectIds: PROJECT_B },
      { version: 1 }
    );
    assert.equal(parsed.projectId, PROJECT_A);
    assert.equal(parsed.projectIds, null);
    assert.equal(parseMissionSearchOptions({ projectId: '  ' }, { version: 1 }).projectId, null);
    // V1 has never validated project id shape.
    assert.equal(
      parseMissionSearchOptions({ projectId: 'not-a-uuid' }, { version: 1 }).projectId,
      'not-a-uuid'
    );
  });

  it('v2/v3 read projectIds CSV, falling back to projectId', () => {
    assert.deepEqual(
      parseMissionSearchOptions({ projectIds: `${PROJECT_A}, ${PROJECT_B}` }, { version: 2 })
        .projectIds,
      [PROJECT_A, PROJECT_B]
    );
    assert.deepEqual(
      parseMissionSearchOptions({ projectId: PROJECT_A }, { version: 3 }).projectIds,
      [PROJECT_A]
    );
    assert.equal(parseMissionSearchOptions({ projectIds: ' , ' }, { version: 2 }).projectIds, null);
    assert.equal(
      parseMissionSearchOptions({ projectId: PROJECT_A }, { version: 2 }).projectId,
      null
    );
  });

  it('v2/v3 reject non-UUID project ids with version-specific messages', () => {
    rejects400(
      () => parseMissionSearchOptions({ projectIds: `${PROJECT_A},alpha` }, { version: 2 }),
      'V2 search accepts only stable project UUIDs in projectIds'
    );
    rejects400(
      () => parseMissionSearchOptions({ projectId: 'alpha' }, { version: 3 }),
      'V3 search accepts only stable project UUIDs in projectIds'
    );
  });

  it('reads v3-only fields only for v3', () => {
    const raw = {
      entityTypes: 'objective, delivery',
      objectiveStates: 'draft',
      matchesPerResult: '2'
    };
    const v3 = parseMissionSearchOptions(raw, { version: 3 });
    assert.deepEqual(v3.entityTypes, ['objective', 'delivery']);
    assert.deepEqual(v3.objectiveStates, ['draft']);
    assert.equal(v3.matchesPerResult, '2');
    const v2 = parseMissionSearchOptions(raw, { version: 2 });
    assert.equal(v2.entityTypes, null);
    assert.equal(v2.objectiveStates, null);
    assert.equal(v2.matchesPerResult, null);
  });
});
