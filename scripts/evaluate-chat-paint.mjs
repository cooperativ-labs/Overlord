#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

// Fresh headless profile and synthetic DOM only: never touches a signed-in browser.
const dir = mkdtempSync(join(tmpdir(), 'overlord-chat-paint-'));
chmodSync(dir, 0o700);
const chrome =
  process.env.CHAT_EVAL_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const child = spawn(
  chrome,
  [
    '--headless=new',
    '--no-first-run',
    '--disable-default-apps',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
);
let socket;
try {
  const bundled = await build({
    entryPoints: [resolve(import.meta.dirname, '../webapp/web/lib/chat/performance.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'chatPerformance'
  });
  let port;
  for (let i = 0; i < 200; i++) {
    try {
      port = Number(readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      break;
    } catch {
      await delay(50);
    }
  }
  if (!port) throw new Error('Chrome debugging port did not become available');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((yes, no) => {
    socket.addEventListener('open', yes, { once: true });
    socket.addEventListener('error', no, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    if (response.id) {
      const item = pending.get(response.id);
      pending.delete(response.id);
      if (response.error) item.reject(new Error(response.error.message));
      else item.resolve(response.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolveCall, reject) => {
      const number = ++id;
      pending.set(number, { resolve: resolveCall, reject });
      socket.send(JSON.stringify({ id: number, method, params }));
    });
  await call('Runtime.evaluate', { expression: bundled.outputFiles[0].text });
  const result = await call('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
    chatPerformance.setChatPerformanceScope('synthetic-owner');
    const results = [];
    for (let i = -2; i < 30; i++) {
      const threadId = 'thread-' + i, runId = 'run-' + i;
      chatPerformance.beginChatPaint(threadId); chatPerformance.bindChatPaint(threadId, runId);
      // Controlled 10ms delivery delay, then actual DOM mutation and compositor frame opportunities.
      await new Promise(r => setTimeout(r, 10));
      document.body.textContent = 'Synthetic assistant reply';
      const stop = chatPerformance.observeChatTextPaint(threadId, runId);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const detail = performance.getEntriesByName('overlord.chat.firstTextPaint').at(-1)?.detail;
      stop();
      if (i >= 0 && detail?.runId === runId) results.push(detail);
    }
    return { chrome: navigator.userAgent, samples: results };
  })()`
  });
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  const raw = result.result.value;
  if (raw.samples.length !== 30) throw new Error('Missing browser observations');
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(raw, null, 2), { mode: 0o600 });
  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      n: values.length,
      min: sorted[0],
      median: sorted[Math.floor(values.length / 2)],
      p95: sorted[Math.ceil(values.length * 0.95) - 1],
      max: sorted.at(-1),
      mean,
      standardDeviation: Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length)
    };
  };
  const aggregates = {
    version: 1,
    measuredAt: new Date().toISOString(),
    chrome: raw.chrome,
    environment: 'fresh headless Chrome; synthetic text DOM, 10ms delivery delay, 2 warmups',
    submittedToDomCommitMs: stats(raw.samples.map(s => s.domCommitMs)),
    submittedToPaintOpportunityMs: stats(raw.samples.map(s => s.paintOpportunityMs)),
    domCommitToPaintOpportunityMs: stats(raw.samples.map(s => s.paintOpportunityMs - s.domCommitMs))
  };
  writeFileSync(join(dir, 'aggregates.json'), JSON.stringify(aggregates, null, 2) + '\n', {
    mode: 0o600
  });
  process.stdout.write(
    JSON.stringify({ privateDir: dir, aggregatePath: join(dir, 'aggregates.json') }) + '\n'
  );
} finally {
  socket?.close();
  child.kill('SIGTERM');
}
