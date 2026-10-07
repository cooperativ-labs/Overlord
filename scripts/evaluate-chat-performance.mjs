#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Synthetic corpus: real gateway, policy, checkpoint and persistence paths; no live writes.
const corpus = [
  ['status', 'gemini-runtime', 'evaluation status query'],
  ['repository-and-kb-read', 'gemini-runtime', 'answers from Knowledgebase and repository'],
  ['repository-search-and-range', 'gemini-runtime', 'evaluation repository search'],
  ['kb-per-message-write', 'knowledgebase-writes', 'writes a linked note and Feature metadata'],
  ['kb-all-workspaces-write', 'knowledgebase-writes', 'a connection allowing all workspaces'],
  ['feature-handoff', 'feature-handoff', 'hands off a ready Feature'],
  ['long-conversation', 'gemini-runtime', 'evaluation long conversation'],
  ['cancellation', 'gemini-runtime', 'cancellation during a read'],
  ['checkpoint-recovery', 'gemini-runtime', 'restarts after requestTools'],
  ['uncertain-write-recovery', 'knowledgebase-writes', 'a write interrupted after it was sent']
];
const repeats = Number(process.env.CHAT_EVAL_REPEATS ?? 5);
if (!Number.isSafeInteger(repeats) || repeats < 3 || repeats > 100)
  throw new Error('CHAT_EVAL_REPEATS must be an integer between 3 and 100');
const root = process.env.CHAT_EVAL_PRIVATE_ROOT
  ? resolve(process.env.CHAT_EVAL_PRIVATE_ROOT)
  : tmpdir();
mkdirSync(root, { recursive: true, mode: 0o700 });
const privateDir = mkdtempSync(join(root, 'overlord-chat-eval-'));
chmodSync(privateDir, 0o700);
const runs = [];
for (const [scenario, file, pattern] of corpus) {
  // Warm both modes, then alternate order to reduce systematic JIT/thermal ordering bias.
  for (let repetition = -1; repetition < repeats; repetition++) {
    const modes = repetition % 2 === 0 ? ['on', 'off'] : ['off', 'on'];
    for (const mode of modes) {
      const stem = `${scenario}-${repetition}-${mode}`;
      const dataPath = join(privateDir, `${stem}.jsonl`);
      writeFileSync(dataPath, '', { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--test',
          '--test-concurrency=1',
          `--test-name-pattern=${pattern}`,
          `backend/chat/${file}.postgres-conformance.test.ts`
        ],
        {
          cwd: resolve(import.meta.dirname, '..'),
          encoding: 'utf8',
          env: { ...process.env, CHAT_EVAL_FILE: dataPath, CHAT_EVAL_MODE: mode },
          maxBuffer: 16 * 1024 * 1024
        }
      );
      writeFileSync(
        join(privateDir, `${stem}.log`),
        (result.stdout ?? '') + (result.stderr ?? ''),
        { mode: 0o600 }
      );
      if (result.status !== 0) throw new Error(`Corpus failed: ${stem}; inspect ${privateDir}`);
      const attempts = readFileSync(dataPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(s => JSON.parse(s));
      if (!attempts.length) throw new Error(`No runtime measurements for ${stem}`);
      if (repetition >= 0) runs.push({ scenario, repetition, mode, attempts });
    }
  }
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    mean,
    standardDeviation: Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length)
  };
};
const summaries = corpus.map(([scenario]) => {
  const selected = runs.filter(r => r.scenario === scenario);
  const totals = mode =>
    selected
      .filter(r => r.mode === mode)
      .map(r => r.attempts.reduce((s, a) => s + a.durationMs, 0));
  const measured = selected
    .filter(r => r.mode === 'on')
    .flatMap(r => r.attempts.map(a => a.metrics).filter(Boolean));
  const spanNames = [...new Set(measured.flatMap(m => Object.keys(m.spans)))];
  const metric = fn => stats(measured.map(fn).filter(v => typeof v === 'number'));
  const on = totals('on'),
    off = totals('off');
  return {
    scenario,
    executionMs: {
      on: stats(on),
      off: stats(off),
      pairedAddedMs: stats(on.map((v, i) => v - off[i]))
    },
    attemptsPerRepetition: selected[0].attempts.length,
    providerRoundsPerAttempt: metric(m => m.providerRounds),
    summaryRoundsPerAttempt: metric(m => m.summaryRounds),
    firstMs: Object.fromEntries(
      ['sdkChunk', 'nonThoughtText', 'durableText'].map(k => [k, metric(m => m.first[k])])
    ),
    spans: Object.fromEntries(spanNames.map(k => [k, metric(m => m.spans[k]?.totalMs)])),
    requestBytes: metric(m => m.schemaBytes.requestTotal),
    systemBytes: metric(m => m.schemaBytes.systemMax),
    toolsBytes: metric(m => m.schemaBytes.toolsMax),
    tokenCoverage: {
      reportedExchanges: measured.reduce((s, m) => s + m.usageExchanges, 0),
      providerExchanges: measured.reduce((s, m) => s + m.providerRounds + m.summaryRounds, 0)
    },
    tokens: Object.fromEntries(
      [
        'promptTokenCount',
        'cachedContentTokenCount',
        'candidatesTokenCount',
        'thoughtsTokenCount'
      ].map(k => [k, metric(m => m.tokens[k])])
    )
  };
});
const report = {
  version: 1,
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  repeats,
  warmupPairs: 1,
  provider: 'scripted (no provider network, billing or model-quality measurement)',
  adapters: [...new Set(runs.flatMap(r => r.attempts.map(a => a.adapter)))],
  rawDiagnosticsDisplay: false,
  instrumentation: 'off retains all raw diagnostic capture',
  summaries
};
writeFileSync(join(privateDir, 'aggregates.json'), JSON.stringify(report, null, 2) + '\n', {
  mode: 0o600
});
process.stdout.write(
  JSON.stringify({
    privateDir,
    aggregatePath: join(privateDir, 'aggregates.json'),
    scenarios: summaries.length,
    repeats
  }) + '\n'
);
