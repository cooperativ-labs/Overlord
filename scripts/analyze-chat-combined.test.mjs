import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyze, cost, stats } from './analyze-chat-combined.mjs';

const record = () => ({
  task: 'status',
  arm: 'current',
  repetition: 0,
  state: 'completed',
  wallMs: 200,
  factsMatched: 3,
  factsTotal: 3,
  citationsResolve: true,
  answer: 'PRIVATE-ANSWER',
  calls: [{ args: { secret: 'PRIVATE-ARGUMENT' } }],
  metrics: {
    completedRounds: 2,
    providerRounds: 2,
    providerRequests: 2,
    usageExchanges: 2,
    tokens: {
      promptTokenCount: 10000,
      cachedContentTokenCount: 4000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 100
    },
    tokenReportedExchanges: {
      promptTokenCount: 2,
      cachedContentTokenCount: 1,
      candidatesTokenCount: 2,
      thoughtsTokenCount: 2
    }
  },
  staticCacheOps: [{ kind: 'provider.cache_create', failed: false, tokens: 2000 }]
});

test('cost includes output/thought once, full TTL storage, and creation sensitivity', () => {
  const c = cost(record());
  assert.ok(Math.abs(c.reportedDiscountInput - 0.0048) < 1e-12);
  assert.ok(Math.abs(c.output - 0.001125) < 1e-12);
  assert.ok(Math.abs(c.storage - ((2000 / 6) * 0.5) / 1e6) < 1e-12);
  assert.ok(Math.abs(c.fullRateCreation - c.noCreation - 0.0015) < 1e-12);
  const partial = record();
  partial.metrics.tokenReportedExchanges.thoughtsTokenCount = 1;
  assert.equal(cost(partial), null);
  const retry = record();
  retry.metrics.providerRequests++;
  assert.equal(cost(retry), null);
});

test('unknown cache coverage stays missing in observations, separate from cost assumptions', () => {
  const r = record();
  delete r.metrics.tokens.cachedContentTokenCount;
  delete r.metrics.tokenReportedExchanges.cachedContentTokenCount;
  assert.equal(cost(r).reportedDiscountInput, 0.0075);
  const result = analyze([r]);
  assert.equal(result.groups['status/current'].tokens.cachedContentTokenCount.n, 0);
  assert.equal(result.groups['status/current'].tokens.cachedContentTokenCount.mean, null);
});

test('publication excludes content and rejects arbitrary labels; paired deltas preserve sign', () => {
  const current = record();
  const baseline = { ...record(), arm: 'baseline', wallMs: 300 };
  const result = analyze([current, baseline]);
  assert.equal(result.groups['status/pairedCurrentMinusBaseline'].wallMs.mean, -100);
  assert.equal(result.groups['status/pairedCurrentMinusBaseline'].comparableCost.pairs, 1);
  baseline.metrics.providerRequests++;
  assert.equal(
    analyze([current, baseline]).groups['status/pairedCurrentMinusBaseline'].comparableCost.pairs,
    0
  );
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|secret|args|answer/);
  assert.throws(() => analyze([{ ...current, task: 'PRIVATE-LABEL' }]), /Unexpected/);
  assert.deepEqual(stats([]), {
    n: 0,
    min: null,
    median: null,
    p95: null,
    max: null,
    mean: null,
    sd: null
  });
  assert.equal(stats([1, 3]).median, 2);
});
