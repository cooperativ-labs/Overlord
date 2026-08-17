import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { isServerRunning, serverProcessPid } from './server.js';

/**
 * Repeatable, in-app measurement of the shell's own process tree.
 *
 * The reported symptom for this work was "a generic `Overlord Helper` using a
 * lot of memory while the Desktop is connected to a Remote backend". On macOS
 * every Electron child is named `Overlord Helper` in Activity Monitor, so the
 * only reliable way to tell an embedded backend `utilityProcess` apart from a
 * renderer or the GPU process is to ask Electron. `app.getAppMetrics()` reports
 * each child's type, its `serviceName` (ours is `overlord-server`) and its
 * working-set size, which is exactly the evidence needed before and after a
 * profile transition.
 *
 * Snapshots go to stderr and are appended as JSON lines to
 * `<userData>/diagnostics/process-inventory.jsonl` so a before/after comparison
 * survives the app relaunch that a profile switch now performs.
 */

export interface ProcessInventoryEntry {
  pid: number;
  type: string;
  serviceName: string | null;
  name: string | null;
  memoryKb: number;
  peakMemoryKb: number;
  isEmbeddedBackend: boolean;
}

export interface ProcessInventorySnapshot {
  tag: string;
  at: string;
  backendMode: string;
  embeddedBackendRunning: boolean;
  embeddedBackendPid: number | null;
  totalMemoryKb: number;
  processes: ProcessInventoryEntry[];
}

const EMBEDDED_BACKEND_SERVICE_NAME = 'overlord-server';

export function collectProcessInventory({
  tag,
  backendMode
}: {
  tag: string;
  backendMode: string;
}): ProcessInventorySnapshot {
  const backendPid = serverProcessPid();
  const processes: ProcessInventoryEntry[] = app.getAppMetrics().map(metric => {
    const serviceName = readOptionalString(metric, 'serviceName');
    return {
      pid: metric.pid,
      type: metric.type,
      serviceName,
      name: readOptionalString(metric, 'name'),
      memoryKb: metric.memory?.workingSetSize ?? 0,
      peakMemoryKb: metric.memory?.peakWorkingSetSize ?? 0,
      isEmbeddedBackend:
        serviceName === EMBEDDED_BACKEND_SERVICE_NAME ||
        (backendPid !== null && metric.pid === backendPid)
    };
  });

  return {
    tag,
    at: new Date().toISOString(),
    backendMode,
    embeddedBackendRunning: isServerRunning(),
    embeddedBackendPid: backendPid,
    totalMemoryKb: processes.reduce((total, entry) => total + entry.memoryKb, 0),
    processes
  };
}

/** Take a snapshot, print it, and append it to the diagnostics log. */
export function recordProcessInventory(options: { tag: string; backendMode: string }): void {
  let snapshot: ProcessInventorySnapshot;
  try {
    snapshot = collectProcessInventory(options);
  } catch (error) {
    process.stderr.write(`[diagnostics] process inventory failed: ${describe(error)}\n`);
    return;
  }

  process.stderr.write(`${formatProcessInventory(snapshot)}\n`);

  try {
    const filePath = processInventoryLogPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(snapshot)}\n`);
  } catch (error) {
    process.stderr.write(`[diagnostics] could not append process inventory: ${describe(error)}\n`);
  }
}

export function processInventoryLogPath(): string {
  return path.join(app.getPath('userData'), 'diagnostics', 'process-inventory.jsonl');
}

export function formatProcessInventory(snapshot: ProcessInventorySnapshot): string {
  const header =
    `[diagnostics] ${snapshot.tag} — mode=${snapshot.backendMode} ` +
    `embeddedBackend=${snapshot.embeddedBackendRunning ? `pid ${snapshot.embeddedBackendPid}` : 'none'} ` +
    `total=${mb(snapshot.totalMemoryKb)}`;
  const rows = snapshot.processes.map(entry => {
    const label = entry.isEmbeddedBackend
      ? 'embedded backend'
      : (entry.serviceName ?? entry.name ?? entry.type);
    return `[diagnostics]   pid ${entry.pid} ${entry.type.padEnd(8)} ${mb(entry.memoryKb).padStart(9)}  ${label}`;
  });
  return [header, ...rows].join('\n');
}

function mb(kb: number): string {
  return `${(kb / 1024).toFixed(1)} MB`;
}

function readOptionalString(source: object, key: string): string | null {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
