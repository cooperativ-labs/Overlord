import { spawnSync } from 'node:child_process';

import { latchBinaryMissingMessage, resolveLatchBinaryPath } from './latch-binary.ts';
import { latchChildEnvironment } from './latch-environment.ts';
import { buildLatchOpenArgs, latchViewerFlagForKind } from './latch-launch.ts';
import type { ViewerOpenAs } from './terminal-profile-types.ts';
import { parseViewerOpenAs } from './terminal-profile-types.ts';

export type LatchSessionState = 'running' | 'exited' | 'stopping' | 'lost';

export type LatchSessionInspection = {
  providerSessionId: string;
  name: string;
  state: LatchSessionState;
  exitCode: number | null;
  inspectedAt: string;
};

export type LatchSessionOpenResult = {
  providerSessionId: string;
  viewer: string;
  opened: boolean;
  /**
   * The shape Latch reports it actually used. Null when this Latch build
   * predates `--as` and therefore reports nothing — which always means a window.
   */
  behavior: ViewerOpenAs | null;
};

export type LatchSessionStopResult = {
  providerSessionId: string;
  state: LatchSessionState;
};

export class LatchSessionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatchSessionCommandError';
  }
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseState(value: unknown): LatchSessionState | null {
  switch (trimmed(value)) {
    case 'running':
      return 'running';
    case 'exited':
      return 'exited';
    case 'stopping':
      return 'stopping';
    case 'lost':
      return 'lost';
    default:
      return null;
  }
}

function runLatchJson({
  executable,
  args
}: {
  executable: string;
  args: string[];
}): Record<string, unknown> {
  const binary = resolveLatchBinaryPath(executable);
  if (!binary) throw new LatchSessionCommandError(latchBinaryMissingMessage(executable));
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: latchChildEnvironment()
  });
  if (result.error) {
    throw new LatchSessionCommandError(result.error.message);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? 'unknown'}`)
      .trim()
      .slice(0, 500);
    throw new LatchSessionCommandError(detail || 'Latch command failed.');
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new LatchSessionCommandError('Latch returned an invalid JSON response.');
  }
}

export function inspectLatchSession({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): LatchSessionInspection {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const report = runLatchJson({
    executable: trimmed(executable) ?? 'latch',
    args: ['inspect', sessionId, '--json']
  });
  const state = parseState(report.state);
  if (!state) throw new LatchSessionCommandError('Latch returned an unsupported session state.');
  const exit =
    report.exit && typeof report.exit === 'object' && !Array.isArray(report.exit)
      ? (report.exit as Record<string, unknown>)
      : null;
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    name: trimmed(report.name) ?? sessionId,
    state,
    exitCode: typeof exit?.code === 'number' && Number.isFinite(exit.code) ? exit.code : null,
    inspectedAt: new Date().toISOString()
  };
}

/**
 * Read the Latch product version so `--as` is only sent to a build that has it.
 * Best-effort: any failure answers null, which omits the flag and opens a
 * window rather than failing an open for a session that is already running.
 */
function readLatchProductVersion(executable: string): string | null {
  try {
    return trimmed(runLatchJson({ executable, args: ['capabilities', '--json'] }).productVersion);
  } catch {
    return null;
  }
}

export function openLatchSession({
  executable = 'latch',
  providerSessionId,
  viewerKind,
  openAs
}: {
  executable?: string | null;
  providerSessionId: string;
  viewerKind: string;
  /**
   * Overlord's own window-or-tab preference. Sent explicitly whenever the CLI
   * supports it so Latch's stored `open.behavior` default can never silently
   * disagree with the setting the user sees in Overlord.
   */
  openAs?: ViewerOpenAs | string | null;
}): LatchSessionOpenResult {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const viewer = latchViewerFlagForKind(viewerKind);
  if (!viewer) {
    throw new LatchSessionCommandError(`Latch cannot open the configured viewer "${viewerKind}".`);
  }
  const exe = trimmed(executable) ?? 'latch';
  const report = runLatchJson({
    executable: exe,
    args: buildLatchOpenArgs({
      providerSessionId: sessionId,
      viewer,
      openAs,
      productVersion: openAs ? readLatchProductVersion(exe) : null
    })
  });
  if (report.opened !== true) {
    throw new LatchSessionCommandError(`Latch did not open the ${viewer} viewer.`);
  }
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    viewer: trimmed(report.viewer) ?? viewer,
    opened: true,
    behavior: trimmed(report.behavior) ? parseViewerOpenAs(report.behavior) : null
  };
}

export function stopLatchSession({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): LatchSessionStopResult {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const report = runLatchJson({
    executable: trimmed(executable) ?? 'latch',
    args: ['stop', sessionId, '--json']
  });
  const state = parseState(report.state);
  if (!state) throw new LatchSessionCommandError('Latch returned an unsupported session state.');
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    state
  };
}
