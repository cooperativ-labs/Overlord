import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-inbox-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const { createInboxItem } = await import('./repository.ts');
const { ApiError } = await import('./errors.ts');

describe('createInboxItem', () => {
  it('accepts an omitted dueDatetime', async () => {
    const item = await createInboxItem({
      title: 'Capture without due date',
      objectives: ['Capture without due date']
    });
    assert.equal(item.dueDatetime, null);
  });

  it('accepts an explicit null dueDatetime', async () => {
    const item = await createInboxItem({
      title: 'Capture with null due date',
      objectives: ['Capture with null due date'],
      dueDatetime: null
    });
    assert.equal(item.dueDatetime, null);
  });

  it('accepts a valid ISO-8601 dueDatetime', async () => {
    const item = await createInboxItem({
      title: 'Capture with due date',
      objectives: ['Capture with due date'],
      dueDatetime: '2026-08-03T12:00:00.000Z'
    });
    assert.equal(item.dueDatetime, '2026-08-03T12:00:00.000Z');
  });

  it('rejects an invalid dueDatetime', async () => {
    await assert.rejects(
      () =>
        createInboxItem({
          title: 'Bad due date',
          objectives: ['Bad due date'],
          dueDatetime: 'not-a-date'
        }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 400 &&
        err.message === 'dueDatetime must be a valid ISO-8601 datetime or null'
    );
  });
});
