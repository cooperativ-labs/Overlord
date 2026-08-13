/**
 * Latch create / open process wrappers for the Runner/CLI Layer.
 *
 * Manifest build and response parsing live in core; this module only owns the
 * on-device process spawns. Create failure is fatal to the launch; open failure
 * is best-effort and must never fail the execution request.
 */

import { latchChildEnvironment } from '@overlord/core/service/latch-environment';
import {
  buildLatchCreateManifest,
  type ExecutionProviderSession,
  latchAttachCommand,
  type LatchCreateReport,
  type LatchLaunchManifest,
  latchViewerFlagForKind,
  parseLatchCreateReport,
  toExecutionProviderSession
} from '@overlord/core/service/latch-launch';
import type { TerminalViewerKind } from '@overlord/core/service/terminal-profile-types';
import { DEFAULT_LATCH_EXECUTABLE } from '@overlord/core/service/terminal-profile-types';
import { spawnSync } from 'node:child_process';

export {
  buildLatchCreateManifest,
  type ExecutionProviderSession,
  latchAttachCommand,
  type LatchCreateReport,
  type LatchLaunchManifest,
  latchViewerFlagForKind,
  parseLatchCreateReport,
  toExecutionProviderSession
};

export type LatchCreateResult = {
  report: LatchCreateReport;
  providerSession: ExecutionProviderSession;
  executable: string;
};

export type LatchOpenResult =
  | { ok: true; viewer: string }
  | { ok: false; warning: string; attachCommand: string };

function spawnLatchJson({
  executable,
  args,
  stdin
}: {
  executable: string;
  args: string[];
  stdin?: string;
}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    input: stdin,
    env: latchChildEnvironment(),
    maxBuffer: 2 * 1024 * 1024
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

/**
 * Create a Latch session from the already-composed terminal command string S.
 * The manifest travels on stdin so launch material never reaches argv.
 */
export function createLatchSession({
  executable = DEFAULT_LATCH_EXECUTABLE,
  commandString,
  cwd,
  env,
  title,
  name,
  commandLabel,
  externalRunId,
  executionTargetId,
  shell = process.env.SHELL?.trim() || '/bin/bash'
}: {
  executable?: string;
  commandString: string;
  cwd: string;
  env: Record<string, string>;
  title?: string | null;
  name?: string | null;
  commandLabel?: string | null;
  externalRunId?: string | null;
  executionTargetId?: string | null;
  shell?: string;
}): LatchCreateResult {
  const manifest = buildLatchCreateManifest({
    commandString,
    shell,
    cwd,
    env,
    title,
    name,
    commandLabel,
    externalRunId
  });
  const result = spawnLatchJson({
    executable,
    args: ['create', '--manifest-file', '-', '--json'],
    stdin: `${JSON.stringify(manifest)}\n`
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? 'null'}`).trim();
    throw new Error(`latch create failed: ${detail}`);
  }
  const report = parseLatchCreateReport(result.stdout);
  if (!report) {
    throw new Error(
      `latch create returned unusable JSON: ${(result.stdout || result.stderr).trim() || '(empty)'}`
    );
  }
  return {
    report,
    providerSession: toExecutionProviderSession({
      createReport: report,
      executionTargetId
    }),
    executable
  };
}

/**
 * Best-effort viewer open. Never throws — caller treats failure as a warning
 * plus an attach action while the Latch session keeps running.
 */
export function openLatchViewer({
  executable = DEFAULT_LATCH_EXECUTABLE,
  providerSessionId,
  viewerKind
}: {
  executable?: string;
  providerSessionId: string;
  viewerKind: TerminalViewerKind | string | null | undefined;
}): LatchOpenResult {
  const viewer = latchViewerFlagForKind(viewerKind);
  const attachCommand = latchAttachCommand({ executable, providerSessionId });
  if (!viewer) {
    return {
      ok: false,
      warning: `Latch has no viewer for kind "${viewerKind ?? 'unknown'}"; session is running — attach with: ${attachCommand}`,
      attachCommand
    };
  }
  const result = spawnLatchJson({
    executable,
    args: ['open', providerSessionId, '--with', viewer, '--json']
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? 'null'}`).trim();
    return {
      ok: false,
      warning: `latch open failed (${detail}); session is running — attach with: ${attachCommand}`,
      attachCommand
    };
  }
  return { ok: true, viewer };
}
