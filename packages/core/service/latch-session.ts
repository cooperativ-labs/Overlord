import { spawnSync } from 'node:child_process';

import { latchChildEnvironment } from './latch-environment.ts';
import { latchViewerFlagForKind } from './latch-launch.ts';

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
  const result = spawnSync(executable, args, {
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

export function openLatchSession({
  executable = 'latch',
  providerSessionId,
  viewerKind
}: {
  executable?: string | null;
  providerSessionId: string;
  viewerKind: string;
}): LatchSessionOpenResult {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const viewer = latchViewerFlagForKind(viewerKind);
  if (!viewer) {
    throw new LatchSessionCommandError(`Latch cannot open the configured viewer "${viewerKind}".`);
  }
  const report = runLatchJson({
    executable: trimmed(executable) ?? 'latch',
    args: ['open', sessionId, '--with', viewer, '--json']
  });
  if (report.opened !== true) {
    throw new LatchSessionCommandError(`Latch did not open the ${viewer} viewer.`);
  }
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    viewer: trimmed(report.viewer) ?? viewer,
    opened: true
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
