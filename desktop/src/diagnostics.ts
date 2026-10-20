import { app, contentTracing, webContents } from 'electron';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createPerformanceCapture } from './performance-capture.js';
import { collectProcessInventory } from './process-inventory.js';

export const diagnosticsDirectory = () => path.join(app.getPath('userData'), 'diagnostics');
export const performanceTracePath = () =>
  path.join(diagnosticsDirectory(), 'performance.trace.json');

export function createDesktopDiagnostics(getBackendMode: () => string) {
  return createPerformanceCapture({
    async start() {
      if (webContents.getAllWebContents().some(contents => contents.isDevToolsOpened())) {
        throw new Error('Close DevTools before recording.');
      }
      await mkdir(diagnosticsDirectory(), { recursive: true, mode: 0o700 });
      // Pre-create with private permissions before Chromium writes the trace.
      await writeFile(performanceTracePath(), '', { mode: 0o600 });
      await chmod(performanceTracePath(), 0o600);
      await contentTracing.startRecording({
        recording_mode: 'record-until-full',
        trace_buffer_size_in_kb: 32 * 1024,
        included_categories: [
          'toplevel',
          'devtools.timeline',
          'v8.execute',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-v8.cpu_profiler'
        ]
      });
    },
    async stop() {
      await contentTracing.stopRecording(performanceTracePath());
    },
    sample: () =>
      collectProcessInventory({ tag: 'performance-capture', backendMode: getBackendMode() }),
    async save(report) {
      await writeFile(
        path.join(diagnosticsDirectory(), 'performance-summary.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            appVersion: app.getVersion(),
            electronVersion: process.versions.electron,
            platform: process.platform,
            cpuNote:
              'Electron percentCPUUsage is averaged since the previous metrics read; the first read is a baseline.',
            ...report
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
    },
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    everySecond(tick) {
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    },
    now: Date.now
  });
}
