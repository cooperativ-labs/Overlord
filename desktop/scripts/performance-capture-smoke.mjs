#!/usr/bin/env node
// Isolated Electron integration check; never opens the user's backend or app data.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'overlord-performance-smoke-'));
try {
  const source = `
    import { app, BrowserWindow } from 'electron';
    import assert from 'node:assert/strict';
    import { readFile, readdir } from 'node:fs/promises';
    import path from 'node:path';
    import { createElement } from ${JSON.stringify(require.resolve('react'))};
    import { renderToStaticMarkup } from ${JSON.stringify(require.resolve('react-dom/server'))};
    import { ExecutingShimmer, StatusSpinner } from ${JSON.stringify(path.join(root, '../webapp/web/components/StatusMotion.tsx'))};
    import { createDesktopDiagnostics, performanceTracePath, diagnosticsDirectory } from ${JSON.stringify(path.join(root, 'src/diagnostics.ts'))};
    app.setPath('userData', ${JSON.stringify(path.join(scratch, 'user-data'))});
    app.whenReady().then(async () => {
      try {
        const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
        await window.loadURL('data:text/html,' + encodeURIComponent('<style>@keyframes move {to {background-position:100px 0}} div {height:200px;background:linear-gradient(red,blue);animation:move 1s infinite}</style><div></div><script>setInterval(function diagnosticWorkload(){const end=performance.now()+15;while(performance.now()<end) Math.sqrt(Math.random())},50)</script>'));
        const capture = createDesktopDiagnostics(() => 'test');
        assert.equal(capture.record().state, 'recording');
        capture.record();
        await capture.whenFinished();
        assert.equal(capture.getStatus().state, 'ready', JSON.stringify(capture.getStatus()));
        const trace = JSON.parse(await readFile(performanceTracePath(), 'utf8'));
        const events = trace.traceEvents;
        assert.ok(events.some(event => event.name === 'ProfileChunk'), 'JavaScript CPU samples missing');
        assert.ok(events.some(event => /Paint|Layout|UpdateLayoutTree/.test(event.name)), 'Rendering events missing');
        const summary = JSON.parse(await readFile(path.join(diagnosticsDirectory(), 'performance-summary.json'), 'utf8'));
        assert.ok(summary.samples.length >= 2 && summary.samples.length <= 18);
        const renderers = summary.samples.flatMap(sample => sample.processes).filter(process => process.rendererUrl);
        assert.ok(renderers.some(process => process.cpuPercent > 0), 'Renderer CPU missing');
        assert.ok(renderers.every(process => process.memoryKb > 0));
        console.log(JSON.stringify({eventCount:events.length, sampleCount:summary.samples.length, rendererCpuMax:Math.max(...renderers.map(process=>process.cpuPercent))}));
        if (${process.argv.includes('--motion')}) {
          const assets = ${JSON.stringify(path.join(root, '../webapp/dist/assets'))};
          const cssFiles = (await readdir(assets)).filter(file => file.endsWith('.css'));
          const css = (await Promise.all(cssFiles.map(file => readFile(path.join(assets, file), 'utf8')))).join('');
          const fixed = renderToStaticMarkup(createElement('div', {className:'relative overflow-hidden',style:{width:600,height:200}}, createElement(ExecutingShimmer), createElement(StatusSpinner)));
          const legacy = '<div style="position:relative;overflow:hidden;width:600px;height:200px"><div style="position:absolute;inset:0;background:linear-gradient(90deg,transparent,#00ff0033,transparent);background-size:200% 100%;animation:legacy-shimmer 3s linear infinite"></div><svg width="14" height="14" class="animate-spin"><circle cx="7" cy="7" r="5" stroke="black" fill="none"/></svg></div>';
          window.webContents.debugger.attach('1.3');
          await window.webContents.debugger.sendCommand('Performance.enable');
          async function styleRecalculations(markup) {
            await window.loadURL('data:text/html,' + encodeURIComponent('<style>'+css+'@keyframes legacy-shimmer {from {background-position:200% 0} to {background-position:-200% 0}}</style>'+markup));
            await new Promise(resolve => setTimeout(resolve, 500));
            const metrics = async () => Object.fromEntries((await window.webContents.debugger.sendCommand('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
            const before = await metrics();
            await new Promise(resolve => setTimeout(resolve, 2000));
            const after = await metrics();
            return after.RecalcStyleCount - before.RecalcStyleCount;
          }
          const legacyRecalculations = await styleRecalculations(legacy);
          const fixedRecalculations = await styleRecalculations(fixed);
          console.log(JSON.stringify({legacyRecalculations, fixedRecalculations}));
          assert.ok(legacyRecalculations > 30, 'Legacy animation did not exercise per-frame style work');
          assert.ok(fixedRecalculations < legacyRecalculations / 4, 'Status motion still causes per-frame style recalculation');
          window.webContents.debugger.detach();
        }
        window.destroy();
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `;
  const entry = path.join(scratch, 'entry.mjs');
  const bundle = path.join(scratch, 'smoke.cjs');
  await writeFile(entry, source);
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['electron']
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [bundle], { env, stdio: 'inherit' });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  }).finally(() => clearTimeout(timeout));
  process.exitCode = code;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
