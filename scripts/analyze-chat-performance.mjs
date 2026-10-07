#!/usr/bin/env node
import { readFileSync } from 'node:fs';

/** Consume a complete owner-authorized diagnostic export; emit content-free aggregates. */
const path = process.argv[2];
if (!path)
  throw new Error(
    'Usage: node scripts/analyze-chat-performance.mjs <private-diagnostics.json> [private-paint-details.json]'
  );
const data = JSON.parse(readFileSync(path, 'utf8'));
if (data.hasMore === true) throw new Error('Drain every diagnostics page before analysis');
const entries = Array.isArray(data) ? data : data.entries;
if (!Array.isArray(entries)) throw new Error('Expected diagnostic entries or { entries }');
const paints = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : [];
const groups = new Map();
const threads = new Map();
for (const entry of entries) {
  if (!Number.isSafeInteger(entry.seq) || entry.seq < 1 || typeof entry.threadId !== 'string')
    throw new Error('Invalid diagnostic sequence or thread');
  const sequences = threads.get(entry.threadId) ?? [];
  sequences.push(entry.seq);
  threads.set(entry.threadId, sequences);
  if (!entry.runId) continue;
  const runEntries = groups.get(entry.runId) ?? [];
  runEntries.push(entry);
  groups.set(entry.runId, runEntries);
}
for (const seqs of threads.values()) {
  seqs.sort((a, b) => a - b);
  if (seqs.some((seq, i) => seq !== i + 1))
    throw new Error('Export is not complete ordered history from sequence 1');
}
const results = [];
for (const [runId, rows] of groups) {
  rows.sort((a, b) => a.seq - b.seq);
  const attempts = rows.filter(r => r.kind === 'performance.attempt').map(r => r.payload);
  const run = rows
    .map(r => r.payload?.run)
    .filter(r => r?.id === runId)
    .at(-1);
  const exchanges = new Map();
  for (const row of rows) {
    const p = row.payload;
    if (!p?.exchangeId) continue;
    const exchange = exchanges.get(p.exchangeId) ?? {};
    if (row.kind === 'provider.request') {
      exchange.method = p.method;
      exchange.request = p.request;
    }
    if (row.kind === 'provider.chunk' && p.chunk?.usageMetadata)
      exchange.usage = p.chunk.usageMetadata;
    if (row.kind === 'provider.response' && p.response?.usageMetadata)
      exchange.usage = p.response.usageMetadata;
    exchanges.set(p.exchangeId, exchange);
  }
  const tokens = {},
    tokenCoverage = {};
  let totalRequestBytes = 0,
    systemBytes = 0,
    toolsBytes = 0;
  for (const e of exchanges.values()) {
    if (e.request) {
      totalRequestBytes += Buffer.byteLength(JSON.stringify(e.request));
      systemBytes = Math.max(
        systemBytes,
        Buffer.byteLength(e.request.config?.systemInstruction ?? '')
      );
      toolsBytes = Math.max(
        toolsBytes,
        Buffer.byteLength(JSON.stringify(e.request.config?.tools ?? []))
      );
    }
    for (const key of [
      'promptTokenCount',
      'cachedContentTokenCount',
      'candidatesTokenCount',
      'thoughtsTokenCount'
    ]) {
      const value = e.usage?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        tokens[key] = (tokens[key] ?? 0) + value;
        tokenCoverage[key] = (tokenCoverage[key] ?? 0) + 1;
      }
    }
  }
  const first = name => {
    const values = attempts
      .filter(m => typeof m.first?.[name] === 'number')
      .map(m => Date.parse(m.startedAt) + m.first[name] - Date.parse(run?.created_at));
    return values.length && run?.created_at ? Math.min(...values) : null;
  };
  const spans = {};
  for (const m of attempts)
    for (const [key, span] of Object.entries(m.spans ?? {})) {
      const target = (spans[key] ??= { count: 0, totalMs: 0 });
      target.count += span.count;
      target.totalMs += span.totalMs;
    }
  const paint = paints.map(p => p.detail ?? p).find(p => p.runId === runId);
  const wallMs = run?.completed_at
    ? Date.parse(run.completed_at) - Date.parse(run.created_at)
    : null;
  results.push({
    ordinal: results.length + 1,
    state: run?.state ?? null,
    completeRunWallMs: wallMs !== null && wallMs >= 0 ? wallMs : null,
    measuredAttempts: attempts.length,
    providerRequests: [...exchanges.values()].filter(e => e.method === 'stream').length,
    summaryRequests: [...exchanges.values()].filter(e => e.method === 'generate').length,
    firstFromRunCreatedMs: {
      sdkChunk: first('sdkChunk'),
      nonThoughtText: first('nonThoughtText'),
      durableText: first('durableText')
    },
    browserFromSubmissionMs: paint
      ? { domCommit: paint.domCommitMs, paintOpportunity: paint.paintOpportunityMs }
      : null,
    tokens,
    tokenCoverage,
    totalRequestBytes,
    systemBytes,
    toolsBytes,
    spans
  });
}
process.stdout.write(
  JSON.stringify(
    {
      version: 1,
      threads: threads.size,
      runs: results.length,
      diagnosticRows: entries.length,
      orderedHistory: true,
      clockNote:
        'Server firsts join wall-clock attempt origins to monotonic offsets; browser uses its own submission clock. Never subtract browser and server clocks. Nested/concurrent spans overlap.',
      results
    },
    null,
    2
  ) + '\n'
);
