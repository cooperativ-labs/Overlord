#!/usr/bin/env node
// Publish numeric/fixed-label aggregates only. Input is the owner-private JSONL
// produced by research-planning.live-eval.ts, including partial/failed runs.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function stats(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length)
    return { n: 0, min: null, median: null, p95: null, max: null, mean: null, sd: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n: xs.length,
    min: xs[0],
    median: (xs[Math.floor((xs.length - 1) / 2)] + xs[Math.ceil((xs.length - 1) / 2)]) / 2,
    p95: xs[Math.ceil(xs.length * 0.95) - 1],
    max: xs.at(-1),
    mean,
    sd: Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
  };
}

const rates = { input: 0.75, cached: 0.075, outputIncludingThought: 3.75, storagePerHour: 0.5 };
const buckets = [
  'promptTokenCount',
  'cachedContentTokenCount',
  'candidatesTokenCount',
  'thoughtsTokenCount'
];
const tasks = [
  'repository-research',
  'notes-vs-code',
  'knowledgebase-research',
  'status',
  'ambiguous',
  'expansion'
];

export function cost(record) {
  const m = record.metrics;
  const t = m?.tokens;
  // An absent cached bucket is NOT rewritten in the observed tokens. This separate
  // rate model explicitly assumes an absent cache field means no discount.
  if (
    !t ||
    !['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount'].every(
      k => Number.isFinite(t[k]) && m.tokenReportedExchanges?.[k] === m.usageExchanges
    ) ||
    m.completedRounds !== m.usageExchanges ||
    m.providerRequests !== m.completedRounds
  )
    return null;
  const prompt = t.promptTokenCount;
  const cached = t.cachedContentTokenCount ?? 0;
  const ops = record.staticCacheOps ?? [];
  const creations = ops.filter(o => o.kind === 'provider.cache_create' && !o.failed);
  if (creations.some(o => !Number.isFinite(o.tokens))) return null;
  const cacheTokens = creations.reduce((s, o) => s + o.tokens, 0);
  const storage = (cacheTokens * (600 / 3600) * rates.storagePerHour) / 1e6;
  const output =
    ((t.candidatesTokenCount + t.thoughtsTokenCount) * rates.outputIncludingThought) / 1e6;
  const input = ((prompt - cached) * rates.input + cached * rates.cached) / 1e6;
  return {
    reportedDiscountInput: input,
    output,
    storage,
    creationUpper: (cacheTokens * rates.input) / 1e6,
    noCreation: input + output + storage,
    fullRateCreation: input + output + storage + (cacheTokens * rates.input) / 1e6,
    // Loose sensitivity floor: all input cached, even where no cached bucket was
    // reported. This is a bound, never a measured bill or expected outcome.
    allInputCachedFloor: (prompt * rates.cached) / 1e6 + output + storage
  };
}

export function analyze(records) {
  for (const r of records) {
    if (!tasks.includes(r.task) || !['baseline', 'current'].includes(r.arm))
      throw new Error('Unexpected task/arm: refusing to publish arbitrary labels');
  }
  const groups = {};
  for (const task of [...tasks, 'primary', 'all']) {
    const selected = records.filter(
      r =>
        task === 'all' ||
        (task === 'primary' ? tasks.slice(0, 4).includes(r.task) : r.task === task)
    );
    for (const arm of ['baseline', 'current']) {
      const rs = selected.filter(r => r.arm === arm);
      if (!rs.length) continue;
      const metric = fn => stats(rs.map(fn));
      const costs = rs.map(cost).filter(Boolean);
      groups[`${task}/${arm}`] = {
        runs: rs.length,
        completed: rs.filter(r => r.state === 'completed').length,
        errors: rs.filter(r => r.error).length,
        quality: {
          allFacts: rs.filter(r => r.factsMatched === r.factsTotal).length,
          factsMatched: rs.reduce((s, r) => s + r.factsMatched, 0),
          factsTotal: rs.reduce((s, r) => s + r.factsTotal, 0),
          resolvingCitations: rs.filter(r => r.citationsResolve).length
        },
        wallMs: metric(r => r.wallMs),
        requests: metric(r => r.metrics?.providerRequests),
        rounds: metric(r => r.metrics?.providerRounds),
        firstMs: Object.fromEntries(
          ['sdkChunk', 'nonThoughtText', 'durableText'].map(k => [
            k,
            metric(r => r.metrics?.first?.[k])
          ])
        ),
        tokens: Object.fromEntries(buckets.map(k => [k, metric(r => r.metrics?.tokens?.[k])])),
        observedTokenSums: Object.fromEntries(
          buckets.map(k => [k, rs.reduce((s, r) => s + (r.metrics?.tokens?.[k] ?? 0), 0)])
        ),
        usageCoverage: {
          completedRounds: rs.reduce((s, r) => s + (r.metrics?.completedRounds ?? 0), 0),
          reportedExchanges: rs.reduce((s, r) => s + (r.metrics?.usageExchanges ?? 0), 0),
          buckets: Object.fromEntries(
            buckets.map(k => [
              k,
              rs.reduce((s, r) => s + (r.metrics?.tokenReportedExchanges?.[k] ?? 0), 0)
            ])
          )
        },
        cache: {
          requests: rs.reduce((s, r) => s + (r.metrics?.staticCache?.requests ?? 0), 0),
          fallbacks: rs.reduce((s, r) => s + (r.metrics?.staticCache?.fallbacks ?? 0), 0),
          created: rs
            .flatMap(r => r.staticCacheOps ?? [])
            .filter(o => o.kind === 'provider.cache_create' && !o.failed).length,
          failures: rs.flatMap(r => r.staticCacheOps ?? []).filter(o => o.failed).length
        },
        modeledUsdPerRun: Object.fromEntries(
          [
            'reportedDiscountInput',
            'output',
            'storage',
            'creationUpper',
            'noCreation',
            'fullRateCreation',
            'allInputCachedFloor'
          ].map(k => [k, stats(costs.map(c => c[k]))])
        )
      };
    }
    const pairs = selected
      .filter(r => r.arm === 'baseline')
      .map(b => {
        const c = selected.find(
          r => r.arm === 'current' && r.task === b.task && r.repetition === b.repetition
        );
        return c ? { b, c } : null;
      })
      .filter(Boolean);
    const costPairs = pairs.map(({ b, c }) => ({ b: cost(b), c: cost(c) })).filter(p => p.b && p.c);
    if (pairs.length)
      groups[`${task}/pairedCurrentMinusBaseline`] = {
        comparableCost: {
          pairs: costPairs.length,
          baselineNoCreationUsd: stats(costPairs.map(p => p.b.noCreation)),
          currentNoCreationUsd: stats(costPairs.map(p => p.c.noCreation)),
          currentFullRateCreationUsd: stats(costPairs.map(p => p.c.fullRateCreation)),
          noCreationDeltaUsd: stats(costPairs.map(p => p.c.noCreation - p.b.noCreation)),
          fullRateCreationDeltaUsd: stats(
            costPairs.map(p => p.c.fullRateCreation - p.b.fullRateCreation)
          )
        },
        wallMs: stats(pairs.map(({ b, c }) => c.wallMs - b.wallMs)),
        promptTokens: stats(
          pairs.map(
            ({ b, c }) => c.metrics?.tokens?.promptTokenCount - b.metrics?.tokens?.promptTokenCount
          )
        ),
        requests: stats(
          pairs.map(({ b, c }) => c.metrics?.providerRequests - b.metrics?.providerRequests)
        )
      };
  }
  return {
    version: 1,
    ratesUsdPerMillionTokens: rates,
    ratesSource: 'https://ai.google.dev/gemini-api/docs/pricing',
    ratesCheckedAt: '2026-10-07',
    costMethod:
      'Conditional rate model, not billed cost: absent cached field gets no discount; all other buckets must cover every completed exchange and attempts must equal completed exchanges. Full 600s storage for every creation, zero-to-full-input-rate creation sensitivity. allInputCachedFloor is a loose missing-cache sensitivity bound. No overlapping experiment percentages are added.',
    groups
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const records = readFileSync(process.argv[2], 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(s => JSON.parse(s));
  const output = JSON.stringify(analyze(records), null, 2) + '\n';
  if (process.argv[3]) writeFileSync(process.argv[3], output, { mode: 0o600 });
  else process.stdout.write(output);
}
