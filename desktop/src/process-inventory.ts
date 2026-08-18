import { app, webContents } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
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
 *
 * Lifecycle snapshots alone only catch the two ends of a session, which is
 * enough to prove a backend was reaped but useless against a renderer that
 * grows over hours. A low-rate periodic sample (see
 * `startProcessInventorySampling`) turns "the renderer is at 1.7 GB" into a
 * curve with a start time, and each renderer row is attributed to the window it
 * belongs to so a main-window leak is never confused with the quick-task one.
 */

export interface ProcessInventoryEntry {
  pid: number;
  type: string;
  serviceName: string | null;
  name: string | null;
  memoryKb: number;
  peakMemoryKb: number;
  isEmbeddedBackend: boolean;
  /** For renderers: which document this process is hosting, e.g. `/quick-task`. */
  rendererUrl: string | null;
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

/**
 * Map each renderer OS process to the document it is hosting. `getAppMetrics()`
 * reports a `renderer` row with no hint of which window it is, so on its own it
 * cannot tell the main SPA window apart from the quick-task panel.
 */
function rendererUrlsByPid(): Map<number, string> {
  const urls = new Map<number, string>();
  try {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.isDestroyed()) continue;
      const pid = contents.getOSProcessId();
      if (!pid) continue;
      const url = contents.getURL();
      if (url) urls.set(pid, url);
    }
  } catch {
    // Diagnostics must never be able to break a boot or a quit.
  }
  return urls;
}

export function collectProcessInventory({
  tag,
  backendMode
}: {
  tag: string;
  backendMode: string;
}): ProcessInventorySnapshot {
  const backendPid = serverProcessPid();
  const rendererUrls = rendererUrlsByPid();
  const processes: ProcessInventoryEntry[] = app.getAppMetrics().map(metric => {
    const serviceName = readOptionalString(metric, 'serviceName');
    return {
      rendererUrl: rendererUrls.get(metric.pid) ?? null,
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
    rotateIfOversized(filePath);
    appendFileSync(filePath, `${JSON.stringify(snapshot)}\n`);
  } catch (error) {
    process.stderr.write(`[diagnostics] could not append process inventory: ${describe(error)}\n`);
  }
}

const MAX_LOG_BYTES = 4 * 1024 * 1024;

/**
 * Periodic sampling makes this an append-forever file, so keep one generation
 * and start fresh rather than growing without bound in the user's data dir.
 */
function rotateIfOversized(filePath: string): void {
  try {
    if (statSync(filePath).size < MAX_LOG_BYTES) return;
  } catch {
    return;
  }
  try {
    renameSync(filePath, `${filePath}.1`);
  } catch {
    // Keep appending to the current file if the rotation cannot be performed.
  }
}

const DEFAULT_SAMPLE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Sample the process tree on a slow interval for the life of the app.
 *
 * Renderer growth is a curve, not an event: the two lifecycle snapshots say
 * nothing about whether a 1.7 GB renderer got there in an hour or over three
 * days. Ten minutes is slow enough to be free (`getAppMetrics()` is a
 * synchronous read of numbers Chromium already tracks) and fine enough to show
 * the slope. Set `OVERLORD_DESKTOP_PROCESS_SAMPLE_MS=0` to turn it off.
 *
 * Returns a stop function.
 */
export function startProcessInventorySampling({
  getBackendMode
}: {
  getBackendMode: () => string;
}): () => void {
  const intervalMs = parseSampleInterval(process.env.OVERLORD_DESKTOP_PROCESS_SAMPLE_MS);
  if (intervalMs <= 0) return () => {};

  const timer = setInterval(() => {
    recordProcessInventory({ tag: 'sample', backendMode: getBackendMode() });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function parseSampleInterval(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_SAMPLE_INTERVAL_MS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SAMPLE_INTERVAL_MS;
  // Guard against a value low enough to make the diagnostics the problem.
  return parsed === 0 ? 0 : Math.max(30_000, parsed);
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
      : (entry.rendererUrl ?? entry.serviceName ?? entry.name ?? entry.type);
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
