import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.ts';
import { CliError } from './errors.ts';
import { getCliVersion } from './version.ts';

export const RUNNER_INSTANCE_STATE_FILENAME = 'runner-instance.json';

export type RunnerRegistrationPayload = {
  executionTargetId?: string;
  runnerInstanceId: string;
  runnerRelation?: 'native' | 'adopted';
  runnerLabel: string;
  runnerVersion: string;
};

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function runnerInstanceStatePath(dataDir: string = resolveGlobalDataDir()): string {
  return path.join(dataDir, RUNNER_INSTANCE_STATE_FILENAME);
}

/**
 * This runner process's stable instance identity.
 *
 * `OVERLORD_RUNNER_INSTANCE_ID` pins it, which is what a disposable container
 * sets so its registration is stable across restarts without colliding with its
 * host's. Otherwise one is generated once and persisted next to the runner
 * service state, so a workstation's runner keeps the same identity across
 * upgrades and reboots.
 */
export function resolveRunnerInstanceId(dataDir: string = resolveGlobalDataDir()): string {
  const pinned = envValue('OVERLORD_RUNNER_INSTANCE_ID');
  if (pinned) return pinned;

  const statePath = runnerInstanceStatePath(dataDir);
  if (existsSync(statePath)) {
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as { runnerInstanceId?: unknown };
      if (typeof parsed.runnerInstanceId === 'string' && parsed.runnerInstanceId.trim()) {
        return parsed.runnerInstanceId.trim();
      }
    } catch {
      // Unreadable state is regenerated below rather than failing the runner.
    }
  }
  const runnerInstanceId = randomUUID();
  try {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({ runnerInstanceId }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // A read-only home still runs; the identity is simply per-process.
  }
  return runnerInstanceId;
}

/**
 * The runner-instance identity published on every claim (contract v40).
 *
 * `OVERLORD_EXECUTION_TARGET_ID` names an existing target to serve instead of
 * resolving the acting machine's own — this is how an AgentPod container adopts
 * its host: the host's target id, its own distinct runner instance id, and
 * `OVERLORD_RUNNER_RELATION=adopted`. None of it can create a target; an
 * unresolvable id fails the claim with `no_execution_target_registered`.
 */
export function runnerRegistrationPayload(
  dataDir: string = resolveGlobalDataDir()
): RunnerRegistrationPayload {
  const executionTargetId = envValue('OVERLORD_EXECUTION_TARGET_ID');
  const relationEnv = envValue('OVERLORD_RUNNER_RELATION') as 'native' | 'adopted' | null;
  if (relationEnv && relationEnv !== 'native' && relationEnv !== 'adopted') {
    throw new CliError({
      message: `OVERLORD_RUNNER_RELATION must be "native" or "adopted" (got "${relationEnv}").`
    });
  }
  // An adopting container has, by definition, no target of its own to fall back
  // to. Saying so here beats letting the claim resolve this machine's hostname
  // and silently serve the wrong target.
  if (relationEnv === 'adopted' && !executionTargetId) {
    throw new CliError({
      message:
        'OVERLORD_RUNNER_RELATION=adopted requires OVERLORD_EXECUTION_TARGET_ID naming the host execution target this runner adopts.'
    });
  }

  return {
    ...(executionTargetId ? { executionTargetId } : {}),
    runnerInstanceId: resolveRunnerInstanceId(dataDir),
    // Left unset unless declared: the backend knows whether the named target is
    // this machine's own and derives native/adopted from that.
    ...(relationEnv ? { runnerRelation: relationEnv } : {}),
    runnerLabel: envValue('OVERLORD_DEVICE_LABEL') ?? hostname(),
    runnerVersion: getCliVersion()
  };
}
