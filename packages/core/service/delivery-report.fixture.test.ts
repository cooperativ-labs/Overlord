import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDeliveryReport, readDeliveryReport } from './delivery-report.js';

type DeliveryReportFixture = {
  name: string;
  summary: string;
  deliveryReport?: unknown;
  expectedHumanActionCount?: number;
  expectedTradeoffCount?: number;
  expectedWarningCount?: number;
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
    });
  }

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
