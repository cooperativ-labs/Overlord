#!/usr/bin/env node
// Benchmarks the chat diagnostics viewer on large synthetic histories in a fresh headless Chrome.
// Compares the working-tree component with a baseline revision (default HEAD) using the same
// mocked ordered paging; never touches a signed-in browser or real diagnostic content.
//   node scripts/evaluate-chat-diagnostics-viewer.mjs [--sizes 1000,5000,10000] [--runs 3] [--baseline HEAD]
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const { values: options } = parseArgs({
  options: {
    sizes: { type: 'string', default: '1000,5000,10000' },
    runs: { type: 'string', default: '3' },
    baseline: { type: 'string', default: 'HEAD' }
  }
});
const sizes = options.sizes.split(',').map(Number);
const runs = Number(options.runs);
const root = resolve(import.meta.dirname, '..');
const chatDir = join(root, 'webapp/web/components/chat');
const baselineSource = execFileSync(
  'git',
  ['show', `${options.baseline}:webapp/web/components/chat/ChatDiagnostics.tsx`],
  { cwd: root, encoding: 'utf8' }
);

const bundled = await build({
  stdin: {
    contents: `
      import { createElement } from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { api } from '@/lib/api.ts';
      import { ChatDiagnostics as Current } from './ChatDiagnostics.tsx';
      import { ChatDiagnostics as Baseline } from 'virtual:baseline-viewer';
      window.viewerBench = { Current, Baseline, api, createElement, createRoot, flushSync };
    `,
    resolveDir: chatDir,
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  minify: true,
  tsconfig: join(root, 'webapp/tsconfig.json'),
  plugins: [
    {
      name: 'baseline-viewer',
      setup(b) {
        b.onResolve({ filter: /^virtual:baseline-viewer$/ }, () => ({
          path: 'baseline',
          namespace: 'baseline'
        }));
        b.onLoad({ filter: /.*/, namespace: 'baseline' }, () => ({
          contents: baselineSource,
          loader: 'tsx',
          resolveDir: chatDir
        }));
      }
    }
  ]
});

// Minimal stand-ins for the Tailwind utilities that drive the viewer's layout.
const css = `*{box-sizing:border-box}body{margin:0;width:900px;font-family:monospace}
.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.min-h-0{min-height:0}
.max-h-80{max-height:20rem}.min-h-24{min-height:6rem}.overflow-auto{overflow:auto}
.text-xs{font-size:.75rem;line-height:1rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}
.py-2{padding-top:.5rem;padding-bottom:.5rem}.px-4{padding-left:1rem;padding-right:1rem}
.pb-3{padding-bottom:.75rem}.border-t{border-top:1px solid #ccc}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.break-all{word-break:break-all}.whitespace-pre-wrap{white-space:pre-wrap}`;

// Runs inside the page. Payload mix follows the audited thread: per 15 rows one growing
// provider.request body, one response, one tool response and twelve streamed chunks.
const pageProgram = String.raw`
window.benchSetup = (count) => {
  const text = n => 'x'.repeat(n);
  const pages = new Map();
  const make = seq => {
    const slot = seq % 15;
    const kind = slot === 0 ? 'provider.request' : slot === 1 ? 'provider.response'
      : slot === 2 ? 'tool.response' : 'provider.chunk';
    const payload = kind === 'provider.request'
      ? { model: 'gemini', contents: Array.from({ length: 4 + (seq / 15) % 30 }, (_, i) =>
          ({ role: i % 2 ? 'model' : 'user', parts: [{ text: text(5000) }] })) }
      : kind === 'provider.response' ? { usageMetadata: { promptTokenCount: seq }, text: text(1500) }
      : kind === 'tool.response' ? { name: 'repository_read', result: { content: text(5000) } }
      : { candidates: [{ content: { parts: [{ text: text(300) }] } }], sdkConsumedAtMs: seq };
    return { seq, threadId: 'thread', runId: 'run-' + Math.floor(seq / 500),
      attemptId: 'attempt-' + Math.floor(seq / 500), kind, createdAt: new Date(seq * 1000).toISOString(),
      payload };
  };
  let bytes = 0;
  for (let after = 0; after < count; after += 100) {
    const entries = [];
    for (let seq = after + 1; seq <= Math.min(count, after + 100); seq++) entries.push(make(seq));
    const body = JSON.stringify({ entries, nextCursor: entries.at(-1).seq, hasMore: after + 100 < count });
    bytes += body.length;
    pages.set(after, body);
  }
  window.bench = { count, pages, bytes, make, calls: 0, parseMs: 0, live: [], last: count };
};
window.benchMount = async (variant) => {
  const b = window.bench, v = window.viewerBench;
  v.api.getChatDiagnostics = async (_id, after = 0) => {
    b.calls++;
    let body = b.pages.get(after);
    if (body === undefined) {
      const entries = b.live.filter(e => e.seq > after);
      body = JSON.stringify({ entries, nextCursor: entries.at(-1)?.seq ?? after, hasMore: false });
    }
    const t = performance.now();
    const page = JSON.parse(body);
    b.parseMs += performance.now() - t;
    return page;
  };
  let longTaskMs = 0, longTasks = 0;
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) { longTaskMs += e.duration; longTasks++; }
  }).observe({ type: 'longtask' });
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const header = () => document.querySelector('strong')?.textContent ?? '';
  const until = async (predicate) => { while (!predicate()) await new Promise(r => requestAnimationFrame(r)); };
  const host = document.createElement('div');
  document.body.append(host);
  const t0 = performance.now();
  v.createRoot(host).render(v.createElement(variant === 'baseline' ? v.Baseline : v.Current, { threadId: 'thread' }));
  await until(() => header().includes(' ' + b.count + ' entries'));
  await frames();
  const drainMs = performance.now() - t0;
  const drain = { drainMs, parseMs: b.parseMs, longTaskMs, longTasks,
    renderedRows: document.querySelectorAll('details').length };
  // Live append: one new row per idle poll, measured from availability to the next frame.
  const appendMs = [];
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1100));
    const seq = ++b.last;
    const before = header();
    b.live.push(b.make(seq));
    const t = performance.now();
    await until(() => header() !== before);
    await frames();
    appendMs.push(performance.now() - t);
  }
  // Scroll the full history in 20 steps and to the end.
  const scroller = document.querySelector('section .overflow-auto');
  const scrollMs = [];
  for (let i = 0; i <= 20; i++) {
    const t = performance.now();
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * i / 20;
    await frames();
    scrollMs.push(performance.now() - t);
  }
  // Expand the last visible provider.request row (largest payload class).
  const target = [...document.querySelectorAll('details')].reverse()
    .find(d => d.textContent.includes('provider.request'));
  const t1 = performance.now();
  target.querySelector('summary').click();
  await until(() => target.querySelector('pre'));
  await frames();
  const expandMs = performance.now() - t1;
  const expandedChars = target.querySelector('pre').textContent.length;
  // Hidden view: count polls over 3 seconds while document.visibilityState is hidden.
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(r => setTimeout(r, 100));
  const before = b.calls;
  await new Promise(r => setTimeout(r, 3000));
  const hiddenPolls = b.calls - before;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  return { ...drain, appendMs, scrollMs, expandMs, expandedChars, hiddenPolls,
    domNodes: document.getElementsByTagName('*').length,
    finalRows: document.querySelectorAll('details').length, pageBytes: b.bytes };
};`;

const dir = mkdtempSync(join(tmpdir(), 'overlord-diagnostics-viewer-'));
chmodSync(dir, 0o700);
const chrome =
  process.env.CHAT_EVAL_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const child = spawn(
  chrome,
  [
    '--headless=new',
    '--no-first-run',
    '--disable-default-apps',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
);
let socket;
try {
  let port;
  for (let i = 0; i < 200 && !port; i++) {
    try {
      port = Number(readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
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
    if (!response.id) return;
    const item = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) item.reject(new Error(response.error.message));
    else item.resolve(response.result);
  });
  const call = (method, params = {}) =>
    new Promise((yes, no) => {
      const number = ++id;
      pending.set(number, { resolve: yes, reject: no });
      socket.send(JSON.stringify({ id: number, method, params }));
    });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result.value;
  };
  const heap = async () => {
    await call('HeapProfiler.collectGarbage');
    await call('HeapProfiler.collectGarbage');
    return (await call('Runtime.getHeapUsage')).usedSize;
  };
  const metric = async () =>
    Object.fromEntries(
      (await call('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value])
    );
  await call('HeapProfiler.enable');
  await call('Performance.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });

  const samples = [];
  for (const size of sizes) {
    for (let run = 0; run < runs; run++) {
      // Alternate order so neither variant always runs on a warmer process.
      const order = run % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
      for (const variant of order) {
        await call('Page.navigate', { url: 'about:blank' });
        await delay(200);
        await evaluate(
          `document.head.innerHTML = ${JSON.stringify(`<style>${css}</style>`)}; undefined`
        );
        await evaluate(bundled.outputFiles[0].text + ';undefined');
        await evaluate(pageProgram + `;benchSetup(${size});undefined`);
        const heapBefore = await heap();
        const before = await metric();
        const result = await evaluate('benchMount(' + JSON.stringify(variant) + ')');
        const after = await metric();
        const heapAfter = await heap();
        samples.push({
          size,
          run,
          variant,
          ...result,
          viewerHeapBytes: heapAfter - heapBefore,
          scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
          styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
        });
        process.stderr.write(
          `${variant} n=${size} #${run}: drain ${result.drainMs.toFixed(0)}ms heap ${(
            (heapAfter - heapBefore) /
            2 ** 20
          ).toFixed(1)}MiB rows ${result.finalRows} hiddenPolls ${result.hiddenPolls}\n`
        );
      }
    }
  }
  const browser = await evaluate('navigator.userAgent');
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(samples, null, 2), { mode: 0o600 });

  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      n: values.length,
      min: sorted[0],
      median: sorted[Math.floor((values.length - 1) / 2)],
      p95: sorted[Math.ceil(values.length * 0.95) - 1],
      max: sorted.at(-1),
      mean,
      standardDeviation: Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length)
    };
  };
  const scenarios = {};
  for (const size of sizes) {
    for (const variant of ['baseline', 'current']) {
      const group = samples.filter(s => s.size === size && s.variant === variant);
      scenarios[`${size}:${variant}`] = {
        size,
        variant,
        historyJsonBytes: group[0].pageBytes,
        drainMs: stats(group.map(s => s.drainMs)),
        parseMs: stats(group.map(s => s.parseMs)),
        longTaskMs: stats(group.map(s => s.longTaskMs)),
        scriptMs: stats(group.map(s => s.scriptMs)),
        layoutMs: stats(group.map(s => s.layoutMs)),
        styleMs: stats(group.map(s => s.styleMs)),
        viewerHeapMiB: stats(group.map(s => s.viewerHeapBytes / 2 ** 20)),
        domNodes: stats(group.map(s => s.domNodes)),
        renderedRows: stats(group.map(s => s.finalRows)),
        appendToFrameMs: stats(group.flatMap(s => s.appendMs)),
        scrollStepToFrameMs: stats(group.flatMap(s => s.scrollMs)),
        expandToFrameMs: stats(group.map(s => s.expandMs)),
        expandedPayloadChars: stats(group.map(s => s.expandedChars)),
        hiddenPollsPer3s: stats(group.map(s => s.hiddenPolls))
      };
    }
  }
  const aggregates = {
    version: 1,
    measuredAt: new Date().toISOString(),
    browser,
    baselineRevision: execFileSync('git', ['rev-parse', options.baseline], {
      cwd: root,
      encoding: 'utf8'
    }).trim(),
    environment:
      'fresh headless Chrome 900x800, production React bundle, synthetic ordered 100-row pages parsed from JSON strings; one page per variant/run; alternating order',
    runsPerScenario: runs,
    scenarios
  };
  const aggregatePath = join(dir, 'aggregates.json');
  writeFileSync(aggregatePath, JSON.stringify(aggregates, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ privateDir: dir, aggregatePath }) + '\n');
} finally {
  socket?.close();
  child.kill('SIGTERM');
}
