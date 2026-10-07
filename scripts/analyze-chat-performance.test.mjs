import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('private export analysis counts cumulative usage once and separates server/browser clocks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-analysis-test-'));
  try {
    const path = join(dir, 'diagnostics.json'),
      paint = join(dir, 'paint.json');
    const stamp = '2026-10-07T00:00:00.000Z';
    const payloads = [
      ['run.updated', { run: { id: 'run-private', created_at: stamp, state: 'running' } }],
      [
        'provider.request',
        {
          exchangeId: 'exchange-private',
          method: 'stream',
          request: {
            config: { systemInstruction: 'PRIVATE-PROMPT', tools: [] },
            contents: [{ role: 'user', parts: [{ text: 'PRIVATE-SOURCE' }] }]
          }
        }
      ],
      [
        'provider.chunk',
        {
          exchangeId: 'exchange-private',
          chunk: { usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 2 } }
        }
      ],
      [
        'provider.chunk',
        {
          exchangeId: 'exchange-private',
          chunk: { usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 3 } }
        }
      ],
      [
        'performance.attempt',
        {
          startedAt: '2026-10-07T00:00:00.200Z',
          first: { sdkChunk: 100, durableText: 150 },
          spans: { 'text.commit': { count: 1, totalMs: 20 } }
        }
      ],
      [
        'run.updated',
        {
          run: {
            id: 'run-private',
            created_at: stamp,
            completed_at: '2026-10-07T00:00:01.000Z',
            state: 'completed'
          }
        }
      ]
    ];
    const entries = payloads.map(([kind, payload], i) => ({
      seq: i + 1,
      threadId: 'thread-private',
      runId: 'run-private',
      kind,
      payload
    }));
    writeFileSync(path, JSON.stringify(entries), { mode: 0o600 });
    writeFileSync(
      paint,
      JSON.stringify([{ runId: 'run-private', domCommitMs: 350, paintOpportunityMs: 400 }]),
      { mode: 0o600 }
    );
    const call = () =>
      spawnSync(
        process.execPath,
        [join(import.meta.dirname, 'analyze-chat-performance.mjs'), path, paint],
        { encoding: 'utf8' }
      );
    const result = call();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      result.stdout,
      /PRIVATE-PROMPT|PRIVATE-SOURCE|run-private|thread-private|exchange-private/
    );
    const [run] = JSON.parse(result.stdout).results;
    assert.deepEqual(run.tokens, { promptTokenCount: 50, candidatesTokenCount: 3 });
    assert.deepEqual(run.tokenCoverage, { promptTokenCount: 1, candidatesTokenCount: 1 });
    assert.equal(run.completeRunWallMs, 1000);
    assert.equal(run.firstFromRunCreatedMs.sdkChunk, 300);
    assert.equal(run.browserFromSubmissionMs.paintOpportunity, 400);
    writeFileSync(path, JSON.stringify(entries.slice(1)), { mode: 0o600 });
    assert.notEqual(call().status, 0);
    writeFileSync(path, JSON.stringify({ entries, hasMore: true }), { mode: 0o600 });
    assert.notEqual(call().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
