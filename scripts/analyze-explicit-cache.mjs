#!/usr/bin/env node
/**
 * Explicit-cache economics from measured usage. Inputs contain numbers only.
 *   node scripts/analyze-explicit-cache.mjs <probe.json>... --out <aggregate.json>
 * Probe files come from backend/chat/explicit-cache.live-eval.ts; the run distributions come
 * from the retained tool-subset and diagnostics-audit metrics.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : null;
const probes = args
  .filter((a, i) => a !== '--out' && i !== outAt + 1)
  .map(p => JSON.parse(readFileSync(p, 'utf8')));
const read = p => JSON.parse(readFileSync(join(import.meta.dirname, '..', p), 'utf8'));

// USD per 1M tokens (Gemini 3.8 Flash Standard, through 2026-12-31). 2027 doubles every rate,
// so every ratio and go/no-go conclusion below is unchanged; absolute dollars double.
export const PRICES = { input: 0.75, cached: 0.075, storagePerHour: 0.5 };
const usd = (tokens, rate) => (tokens * rate) / 1e6;

/** Cost of one run's prompt input. `exchanges` are [{prompt, cached}] as reported. */
export function implicitCost(exchanges) {
  return exchanges.reduce(
    (s, e) => s + usd(e.prompt - e.cached, PRICES.input) + usd(e.cached, PRICES.cached),
    0
  );
}

/**
 * Same exchanges under an explicit static cache of K tokens. The probe shows a cachedContent
 * request reports exactly K cached tokens and no additional implicit prefix hits.
 * `inlineFirst` keeps the first request uncached while creation runs alongside it.
 * Creation is bounded: billed at nothing beyond storage (low) or at full input rate (high).
 */
export function explicitCost(exchanges, K, { ttlHours, inlineFirst, sharedRuns = 1 }) {
  let cost = 0;
  exchanges.forEach((e, i) => {
    if (inlineFirst && i === 0) cost += implicitCost([e]);
    else cost += usd(e.prompt - K, PRICES.input) + usd(K, PRICES.cached);
  });
  const storage = usd(K, PRICES.storagePerHour) * ttlHours;
  const creationHigh = usd(K, PRICES.input);
  return {
    low: cost + storage / sharedRuns,
    high: cost + (storage + creationHigh) / sharedRuns
  };
}

/**
 * Hybrid: requests whose previous reported prompt is below `switchTokens` use the cache; larger
 * ones go inline and keep their measured implicit hits. Exact per-exchange inputs required.
 */
export function hybridExchanges(exchanges, K, switchTokens) {
  return exchanges.map((e, i) =>
    (exchanges[i - 1]?.prompt ?? 0) < switchTokens
      ? { prompt: e.prompt, cached: K, usesCache: true }
      : { ...e, usesCache: false }
  );
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : null;
};

// 1. Synthetic live probe: per-round reported prompt/cached tokens and first-chunk latency.
const synthetic = { implicit: [], explicit: [], hybrid: [] };
for (const probe of probes) for (const run of probe.runs ?? []) synthetic[run.arm].push(run.rows);
const syntheticSummary = Object.fromEntries(
  Object.entries(synthetic).map(([arm, runs]) => {
    const rounds = Math.max(0, ...runs.map(r => r.length));
    return [
      arm,
      {
        runs: runs.length,
        perRound: Array.from({ length: rounds }, (_, i) => {
          const rows = runs.map(r => r[i]).filter(Boolean);
          return {
            round: i,
            n: rows.length,
            medianPrompt: median(rows.map(r => r.prompt)),
            medianCached: median(rows.map(r => r.cached ?? 0)),
            cachedReported: rows.filter(r => r.cached !== null).length,
            medianFirstChunkMs: Math.round(median(rows.map(r => r.firstChunkMs))),
            minFirstChunkMs: Math.round(Math.min(...rows.map(r => r.firstChunkMs))),
            maxFirstChunkMs: Math.round(Math.max(...rows.map(r => r.firstChunkMs)))
          };
        }),
        medianFirstChunkMsAll: Math.round(median(runs.flat().map(r => r.firstChunkMs)))
      }
    ];
  })
);
const sixRound = arm =>
  synthetic[arm]
    .filter(r => r.length >= 6)
    .map(r => r.slice(0, 6).map(x => ({ prompt: x.prompt, cached: x.cached ?? 0 })));
const tenRound = arm =>
  synthetic[arm]
    .filter(r => r.length >= 10)
    .map(r => r.map(x => ({ prompt: x.prompt, cached: x.cached ?? 0 })));
const measuredArmCost = runs => runs.map(implicitCost); // explicit arm already reports K cached
const syntheticCost = {
  sixRounds: {
    implicitUsd: measuredArmCost(sixRound('implicit')),
    explicitBeforeStorageUsd: measuredArmCost(sixRound('explicit'))
  },
  tenRounds: {
    implicitUsd: measuredArmCost(tenRound('implicit')),
    explicitBeforeStorageUsd: measuredArmCost(tenRound('explicit')),
    hybridBeforeStorageUsd: measuredArmCost(tenRound('hybrid'))
  }
};
const meanOf = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
syntheticCost.tenRounds.means = Object.fromEntries(
  Object.entries(syntheticCost.tenRounds).map(([k, v]) => [k, meanOf(v)])
);

// 2. Retained live corpus (subset arm): per-run totals. K is estimated from the eval's maximum
// declaration bytes using this probe's measured tokens/byte, plus the measured system tokens.
const firstProbe = probes.find(p => p.eligibility) ?? {};
const systemTokens = firstProbe.static?.systemInstructionTokens ?? 845;
const fits = Object.values(firstProbe.eligibility ?? {}).map(
  e => (e.staticTokens - systemTokens) / e.toolsBytes
);
const tokensPerToolByte = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : 0.27;
const subsets = read('docs/reviews/chat-tool-subsets-2026-10-07.metrics.json');
const ttls = [10 / 60, 1];
const corpus = subsets.live.numericRuns
  .filter(r => r.arm === 'current' && r.state === 'completed')
  .map(r => {
    const n = r.completedRounds;
    const prompt = r.tokenTotals.promptTokenCount;
    const cached = r.tokenTotals.cachedContentTokenCount ?? 0;
    const K = Math.round(systemTokens + tokensPerToolByte * r.schemaBytes.toolsMax);
    // Only totals were retained: spread evenly, which is exact for the linear cost model.
    const exchanges = Array.from({ length: n }, () => ({ prompt: prompt / n, cached: cached / n }));
    const implicit = implicitCost(exchanges);
    const hits = r.tokenReportedExchanges?.cachedContentTokenCount ?? 0;
    // Hybrid keeps the h implicit-hit exchanges (large prompts, inline) and caches the rest.
    const hybridCost = inlineFirst => {
      const cachedRequests = Math.max(0, n - hits - (inlineFirst ? 1 : 0));
      return implicit - cachedRequests * usd(K, PRICES.input - PRICES.cached);
    };
    const variants = {};
    for (const ttl of ttls)
      for (const inlineFirst of [false, true])
        for (const sharedRuns of [1, 5]) {
          const e = explicitCost(exchanges, K, { ttlHours: ttl, inlineFirst, sharedRuns });
          const storage = usd(K, PRICES.storagePerHour) * ttl;
          const creation = usd(K, PRICES.input);
          const h = hybridCost(inlineFirst);
          variants[
            `ttl${Math.round(ttl * 60)}m_${inlineFirst ? 'inlineFirst' : 'cachedFirst'}_shared${sharedRuns}`
          ] = {
            netSavingsLowUsd: implicit - e.high,
            netSavingsHighUsd: implicit - e.low,
            hybridNetSavingsLowUsd: implicit - h - (storage + creation) / sharedRuns,
            hybridNetSavingsHighUsd: implicit - h - storage / sharedRuns
          };
        }
    return {
      scenario: r.scenario,
      repetition: r.repetition,
      requests: n,
      prompt,
      reportedCached: cached,
      K,
      implicitUsd: implicit,
      variants
    };
  });

// 3. Audit run A (long research, 28 exchanges, 71.5% implicit cached) under an explicit cache.
const audit = read('docs/reviews/chat-diagnostics-audit-2026-10-07.metrics.json');
const longRun = audit.threads
  .map(t => t.exchanges)
  .sort((a, b) => b.length - a.length)[0]
  .filter(e => e.usage?.promptTokenCount)
  .map(e => ({ prompt: e.usage.promptTokenCount, cached: e.usage.cachedContentTokenCount ?? 0 }));
const auditK = 7859; // retired prompt v5 (980) + full write catalog (6,879), counted in coo:1127.4vwm
const longImplicit = implicitCost(longRun);
const longExplicit = explicitCost(longRun, auditK, { ttlHours: 10 / 60, inlineFirst: false });
const longHybrid = hybridExchanges(longRun, auditK, 16_000);
const longHybridCost = implicitCost(longHybrid);
const longFixed = usd(auditK, PRICES.storagePerHour) / 6;

const result = {
  version: 1,
  prices: PRICES,
  pricesNote:
    'Standard paid tier through 2026-12-31; all rates double on 2027-01-01, ratios unchanged.',
  systemInstructionTokens: systemTokens,
  tokensPerToolByte,
  synthetic: { summary: syntheticSummary, cost: syntheticCost },
  corpus,
  corpusTotals: Object.fromEntries(
    Object.keys(corpus[0]?.variants ?? {}).map(v => [
      v,
      {
        implicitUsd: corpus.reduce((s, r) => s + r.implicitUsd, 0),
        netSavingsLowUsd: corpus.reduce((s, r) => s + r.variants[v].netSavingsLowUsd, 0),
        netSavingsHighUsd: corpus.reduce((s, r) => s + r.variants[v].netSavingsHighUsd, 0),
        hybridNetSavingsLowUsd: corpus.reduce(
          (s, r) => s + r.variants[v].hybridNetSavingsLowUsd,
          0
        ),
        hybridNetSavingsHighUsd: corpus.reduce(
          (s, r) => s + r.variants[v].hybridNetSavingsHighUsd,
          0
        )
      }
    ])
  ),
  longAuditRun: {
    exchanges: longRun.length,
    prompt: longRun.reduce((s, e) => s + e.prompt, 0),
    implicitCached: longRun.reduce((s, e) => s + e.cached, 0),
    explicitCached: auditK * longRun.length,
    implicitUsd: longImplicit,
    explicitUsdLow: longExplicit.low,
    explicitUsdHigh: longExplicit.high,
    hybridCachedRequests: longHybrid.filter(e => e.usesCache).length,
    hybridUsdLow: longHybridCost + longFixed,
    hybridUsdHigh: longHybridCost + longFixed + usd(auditK, PRICES.input)
  }
};
const text = JSON.stringify(result, null, 2);
if (out) writeFileSync(out, text + '\n');
else process.stdout.write(text + '\n');
