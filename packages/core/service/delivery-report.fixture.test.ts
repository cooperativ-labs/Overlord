import type { DeferredWorkV1 } from '@overlord/contract';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDeliveryReport, deferredWorkId, readDeliveryReport } from './delivery-report.js';

type DeliveryReportFixture = {
  name: string;
  summary: string;
  deliveryReport?: unknown;
  expectedHumanActionCount?: number;
  expectedTradeoffCount?: number;
  expectedWarningCount?: number;
  /** Normalized items with their pinned stable ids (contract v166). */
  expectedDeferredWork?: DeferredWorkV1[];
  /** The error code `deliver` and `record-work` return for this envelope. */
  protocolRejects?: string;
  valid?: boolean;
};

const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../contract/delivery-report-v1-fixtures.json', import.meta.url)),
    'utf8'
  )
) as { cases: DeliveryReportFixture[] };

describe('delivery-report-v1 contract fixtures', () => {
  for (const fixture of fixtures.cases) {
    it(fixture.name, () => {
      const report = buildDeliveryReport({
        summary: fixture.summary,
        deliveryReport: fixture.deliveryReport
      });
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.presentation.status, 'deterministic');
      assert.equal(report.presentation.markdown, fixture.summary);
      assert.equal(report.agentReport.humanActions.length, fixture.expectedHumanActionCount);
      assert.equal(report.agentReport.tradeoffsMade.length, fixture.expectedTradeoffCount);
      if (fixture.expectedWarningCount !== undefined) {
        assert.equal(report.warnings?.length ?? 0, fixture.expectedWarningCount);
      }
      assert.deepEqual(report.presentation.humanActions, report.agentReport.humanActions);
      assert.deepEqual(report.presentation.tradeoffsMade, report.agentReport.tradeoffsMade);
      if (fixture.expectedDeferredWork !== undefined) {
        assert.deepEqual(report.agentReport.deferredWork, fixture.expectedDeferredWork);
      }
      assert.deepEqual(report.presentation.deferredWork, report.agentReport.deferredWork);
      assert.deepEqual(
        readDeliveryReport({ summary: fixture.summary, deliveryReport: report }),
        report
      );
    });
  }

  it('derives the deferred-work id from the index and the trimmed canonical object', () => {
    const item = { title: 'Title', change: 'Change.', location: 'a.ts', doneWhen: 'Done.' };
    const padded = { title: ' Title ', change: 'Change. ', location: ' a.ts', doneWhen: 'Done.' };
    assert.equal(deferredWorkId(0, item), deferredWorkId(0, padded));
    assert.notEqual(deferredWorkId(0, item), deferredWorkId(1, item));
    assert.notEqual(deferredWorkId(0, item), deferredWorkId(0, { ...item, doneWhen: 'Other.' }));
    assert.match(deferredWorkId(3, item), /^deferred-work-3-[0-9a-f]{16}$/);
  });

  it('rejects persisted string deferred work under the strict read schema', () => {
    const report = buildDeliveryReport({ summary: 'Legacy', deliveryReport: undefined });
    const legacy = {
      ...report,
      agentReport: { ...report.agentReport, deferredWork: ['Old string item.'] }
    };
    const read = readDeliveryReport({ summary: 'Legacy', deliveryReport: legacy });
    assert.deepEqual(read.agentReport.deferredWork, []);
    assert.equal(read.presentation.markdown, 'Legacy');
  });

  it('falls back safely when persisted nested report shapes are malformed', () => {
    const report = readDeliveryReport({
      summary: 'Safe fallback',
      deliveryReport: {
        schemaVersion: 1,
        agentReport: { humanActions: 'not-an-array' },
        presentation: { markdown: 'malformed' }
      }
    });
    assert.equal(report.presentation.markdown, 'Safe fallback');
    assert.deepEqual(report.agentReport.humanActions, []);
  });
});
