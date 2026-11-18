import type { ReportDraftDto, ReportDraftEntryDto } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeReportDraftEntry,
  orderReportDrafts,
  reportDraftEntryOutcome,
  reportDraftStateCopy,
  shortSessionId,
  withdrawnEntries
} from './objective-report-drafts.ts';

function entry(overrides: Partial<ReportDraftEntryDto> = {}): ReportDraftEntryDto {
  return {
    entryId: 'e-1',
    kind: 'known_risk',
    content: { text: 'Cache may be stale' },
    position: 0,
    state: 'active',
    withdrawnAt: null,
    withdrawnReason: null,
    importedFrom: null,
    sealedRef: null,
    revision: 1,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...overrides
  };
}

function draft(overrides: Partial<ReportDraftDto> = {}): ReportDraftDto {
  return {
    id: 'd-1',
    missionId: 'm-1',
    objectiveId: 'o-1',
    sessionId: 'session-abcdef123',
    state: 'open',
    revision: 1,
    batchCount: 1,
    entryCount: 1,
    activeCounts: { human_action: 0, tradeoff: 0, known_risk: 1, deferred_work: 0, assumption: 0 },
    withdrawnCount: 0,
    sealedAt: null,
    sealedDeliveryId: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    entries: [entry()],
    withdrawn: [],
    ...overrides
  };
}

describe('describeReportDraftEntry', () => {
  it('describes a human action without its blocking or category flags', () => {
    const view = describeReportDraftEntry(
      entry({
        kind: 'human_action',
        content: {
          action: 'Rotate the API key',
          reason: 'Old key leaked',
          blocking: true,
          category: 'credentials',
          command: 'ovld keys rotate',
          verify: 'Old key returns 401'
        }
      })
    );
    assert.equal(view.kindLabel, 'Human action');
    assert.equal(view.title, 'Rotate the API key');
    assert.deepEqual(view.details, [{ label: 'Why', text: 'Old key leaked' }]);
    assert.deepEqual(view.humanActionFields, {
      command: 'ovld keys rotate',
      verify: 'Old key returns 401'
    });
    const rendered = JSON.stringify(view).toLowerCase();
    assert.ok(!rendered.includes('blocking'));
    assert.ok(!rendered.includes('credentials'));
  });

  it('describes a tradeoff, deferred work and text kinds', () => {
    const tradeoff = describeReportDraftEntry(
      entry({
        kind: 'tradeoff',
        content: {
          decision: 'Use SQLite',
          rationale: 'Simpler',
          alternativesConsidered: ['Postgres', ' ', 'Files'],
          impact: 'Single writer'
        }
      })
    );
    assert.equal(tradeoff.title, 'Use SQLite');
    assert.deepEqual(tradeoff.details, [
      { label: 'Why', text: 'Simpler' },
      { label: 'Alternatives', text: 'Postgres; Files' },
      { label: 'Impact', text: 'Single writer' }
    ]);

    const deferred = describeReportDraftEntry(
      entry({
        kind: 'deferred_work',
        content: { title: 'Fix flake', change: 'Retry once', location: 'a.ts', doneWhen: 'Green' }
      })
    );
    assert.equal(deferred.title, 'Fix flake');
    assert.deepEqual(
      deferred.details.map(line => line.label),
      [null, 'Where', 'Done when']
    );

    assert.equal(
      describeReportDraftEntry(entry({ kind: 'assumption', content: { text: 'X' } })).title,
      'X'
    );
    assert.equal(describeReportDraftEntry(entry({ content: {} })).title, '(no text)');
  });
});

describe('state copy and outcomes', () => {
  it('never calls open or abandoned observations accepted', () => {
    for (const state of ['open', 'abandoned'] as const) {
      assert.ok(!/accepted report/i.test(reportDraftStateCopy(state).description));
      assert.equal(reportDraftEntryOutcome(state, { sealedRef: 'knownRisks[0]' }), null);
    }
    assert.match(reportDraftStateCopy('abandoned').description, /never accepted/);
  });

  it('names the accepted item or the exclusion only for sealed drafts', () => {
    assert.equal(
      reportDraftEntryOutcome('sealed', { sealedRef: 'tradeoff-1' }),
      'In the accepted report as tradeoff-1'
    );
    assert.equal(reportDraftEntryOutcome('sealed', { sealedRef: null }), 'Excluded at delivery');
  });
});

describe('ordering and tolerance', () => {
  it('lists open drafts first, then the rest in server order', () => {
    const ordered = orderReportDrafts([
      draft({ id: 'sealed', state: 'sealed' }),
      draft({ id: 'open', state: 'open' }),
      draft({ id: 'abandoned', state: 'abandoned' })
    ]);
    assert.deepEqual(
      ordered.map(item => item.id),
      ['open', 'sealed', 'abandoned']
    );
  });

  it('tolerates a missing withdrawn array and shortens session ids', () => {
    const rest: Partial<ReportDraftDto> = draft();
    delete rest.withdrawn;
    assert.deepEqual(withdrawnEntries(rest as ReportDraftDto), []);
    assert.equal(shortSessionId('session-abcdef123'), 'session-');
    assert.equal(shortSessionId('short'), 'short');
  });
});
