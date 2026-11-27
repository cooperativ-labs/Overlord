import { execFile } from 'node:child_process';

import { trimmedOrNull } from '../strings.ts';
import type { ViewerOpenAs } from '../terminal-profile-types.ts';
import { parseViewerOpenAs } from '../terminal-profile-types.ts';

import { latchBinaryMissingMessage, resolveLatchBinaryPath } from './binary.ts';
import { latchChildEnvironment } from './environment.ts';
import { buildLatchOpenArgs, latchViewerFlagForKind } from './launch.ts';
import { LatchSessionCommandError, latchSessionCommandError } from './session-errors.ts';

export type LatchSessionState = 'running' | 'exited' | 'stopping' | 'lost';

export type LatchSessionInspection = {
  providerSessionId: string;
  name: string;
  state: LatchSessionState;
  exitCode: number | null;
  inspectedAt: string;
  /** Latch-confirmed process exit time; absent on older runners. */
  endedAt?: string | null;
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

function parseState(value: unknown): LatchSessionState | null {
  switch (trimmedOrNull(value)) {
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

async function runLatchJson({
  executable,
  args
}: {
  executable: string;
  args: string[];
}): Promise<Record<string, unknown>> {
  const binary = resolveLatchBinaryPath(executable);
  if (!binary) throw new LatchSessionCommandError(latchBinaryMissingMessage(executable));
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        env: latchChildEnvironment()
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).trim().slice(0, 500);
          reject(latchSessionCommandError(detail));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
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

export async function inspectLatchSession({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): Promise<LatchSessionInspection> {
  const sessionId = trimmedOrNull(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const report = await runLatchJson({
    executable: trimmedOrNull(executable) ?? 'latch',
    args: ['inspect', sessionId, '--json']
  });
  const state = parseState(report.state);
  if (!state) throw new LatchSessionCommandError('Latch returned an unsupported session state.');
  const exit =
    report.exit && typeof report.exit === 'object' && !Array.isArray(report.exit)
      ? (report.exit as Record<string, unknown>)
      : null;
  return {
    providerSessionId: trimmedOrNull(report.id) ?? sessionId,
    name: trimmedOrNull(report.name) ?? sessionId,
    state,
    exitCode: typeof exit?.code === 'number' && Number.isFinite(exit.code) ? exit.code : null,
    endedAt:
      typeof exit?.exitedAt === 'string'
        ? exit.exitedAt
        : typeof exit?.exited_at === 'string'
          ? exit.exited_at
          : null,
    inspectedAt: new Date().toISOString()
  };
}

/**
 * Read the Latch product version so `--as` is only sent to a build that has it.
 * Best-effort: any failure answers null, which omits the flag and opens a
 * window rather than failing an open for a session that is already running.
 */
async function readLatchProductVersion(executable: string): Promise<string | null> {
  try {
    return trimmedOrNull(
      (await runLatchJson({ executable, args: ['capabilities', '--json'] })).productVersion
    );
  } catch {
    return null;
  }
}

export async function openLatchSession({
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
}): Promise<LatchSessionOpenResult> {
  const sessionId = trimmedOrNull(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const viewer = latchViewerFlagForKind(viewerKind);
  if (!viewer) {
    throw new LatchSessionCommandError(`Latch cannot open the configured viewer "${viewerKind}".`);
  }
  const exe = trimmedOrNull(executable) ?? 'latch';
  const report = await runLatchJson({
    executable: exe,
    args: buildLatchOpenArgs({
      providerSessionId: sessionId,
      viewer,
      openAs,
      productVersion: openAs ? await readLatchProductVersion(exe) : null
    })
  });
  if (report.opened !== true) {
    throw new LatchSessionCommandError(`Latch did not open the ${viewer} viewer.`);
  }
  return {
    providerSessionId: trimmedOrNull(report.id) ?? sessionId,
    viewer: trimmedOrNull(report.viewer) ?? viewer,
    opened: true,
    behavior: trimmedOrNull(report.behavior) ? parseViewerOpenAs(report.behavior) : null
  };
}

export async function stopLatchSession({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): Promise<LatchSessionStopResult> {
  const sessionId = trimmedOrNull(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const report = await runLatchJson({
    executable: trimmedOrNull(executable) ?? 'latch',
    args: ['stop', sessionId, '--json']
  });
  const state = parseState(report.state);
  if (!state) throw new LatchSessionCommandError('Latch returned an unsupported session state.');
  return {
    providerSessionId: trimmedOrNull(report.id) ?? sessionId,
    state
  };
}
