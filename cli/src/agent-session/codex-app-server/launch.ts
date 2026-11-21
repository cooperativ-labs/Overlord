import type { AgentLaunchFlagDto } from '@overlord/contract';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, fchmodSync, openSync } from 'node:fs';

import type { BackendClient } from '../../backend-client.js';

import {
  CODEX_APP_SERVER_ADAPTER_KEY,
  CODEX_APP_SERVER_FLAG_ENV,
  CODEX_APP_SERVER_MIN_VERSION,
  isSupportedVersion,
  parseCliVersion
} from './protocol.js';

/**
 * Launch integration for the Codex app-server control plane (coo:1325.ke1y, ADR 0092).
 *
 * An Overlord-launched Codex objective runs in one of two harness modes:
 *  - `hooks` (the default): the interactive `codex <prompt>` terminal, observed through the
 *    Overlord Codex plugin's hooks (`connectors/adapters/codex/`).
 *  - `appServer`: launch mints a session channel, starts the control-plane supervisor detached
 *    (`ovld agent-session sidecar --agent codex-app-server`), which spawns a private app server,
 *    starts a thread with the objective's settings and sends the objective prompt as the first
 *    turn. The visible terminal, when there is one, runs `ovld agent-session attach`, which opens
 *    `codex --remote unix://… resume <thread>` against that server.
 *
 * App-server mode is experimental and off unless chosen: per user and machine in Settings →
 * Terminal & IDE (the Codex launch config's `harnessMode`), per project by setting
 * `OVERLORD_CODEX_APP_SERVER=1` in the project's launch env vars, or for a runner by its own
 * environment. User-started Codex sessions never use it.
 */

export type CodexHarnessMode = 'hooks' | 'appServer';

export function resolveCodexHarnessMode({
  agent,
  configuredMode,
  env = process.env,
  launchEnvVars
}: {
  agent: string;
  configuredMode?: string | null;
  env?: NodeJS.ProcessEnv;
  launchEnvVars?: Record<string, string> | null;
}): CodexHarnessMode {
  if (agent !== 'codex') return 'hooks';
  if (configuredMode === 'appServer') return 'appServer';
  if (env[CODEX_APP_SERVER_FLAG_ENV]?.trim() === '1') return 'appServer';
  if (launchEnvVars?.[CODEX_APP_SERVER_FLAG_ENV]?.trim() === '1') return 'appServer';
  return 'hooks';
}

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type CodexThreadLaunchSettings = {
  approvalPolicy: CodexApprovalPolicy | null;
  sandbox: CodexSandboxMode | null;
  /** Flags the app server has no equivalent for; reported, never silently dropped. */
  ignored: string[];
};

const APPROVAL_POLICIES = new Set<string>(['untrusted', 'on-request', 'never']);
const SANDBOX_MODES = new Set<string>(['read-only', 'workspace-write', 'danger-full-access']);

/**
 * Translate the Codex launch flags a person configured for the terminal into thread settings.
 *
 * The app server takes the approval policy and sandbox per thread, not as argv, so the flags that
 * set them are mapped and everything else is reported as ignored. `approvalsReviewer` is never a
 * setting: it is always `user` (see `buildThreadStartParams`).
 */
export function codexThreadSettingsFromFlags(
  flags: AgentLaunchFlagDto[] = []
): CodexThreadLaunchSettings {
  const settings: CodexThreadLaunchSettings = { approvalPolicy: null, sandbox: null, ignored: [] };
  for (const flag of flags) {
    const name = flag.name.trim();
    const value = flag.value?.trim() ?? null;
    if (name === '--ask-for-approval' || name === '-a') {
      // `on-failure` is deprecated in Codex; it behaves as `on-request` for an Overlord thread.
      const policy = value === 'on-failure' ? 'on-request' : value;
      if (policy && APPROVAL_POLICIES.has(policy)) {
        settings.approvalPolicy = policy as CodexApprovalPolicy;
        continue;
      }
    } else if (name === '--sandbox' || name === '-s') {
      if (value && SANDBOX_MODES.has(value)) {
        settings.sandbox = value as CodexSandboxMode;
        continue;
      }
    } else if (name === '--full-auto') {
      settings.approvalPolicy = 'on-request';
      settings.sandbox = 'workspace-write';
      continue;
    } else if (name === '--dangerously-bypass-approvals-and-sandbox' || name === '--yolo') {
      settings.approvalPolicy = 'never';
      settings.sandbox = 'danger-full-access';
      continue;
    } else if (name === '--model' || name === '-m') {
      // The launch's own model wins; the flag is redundant rather than ignored.
      continue;
    }
    settings.ignored.push(value ? `${name} ${value}` : name);
  }
  return settings;
}

/** How to run this same `ovld` again: the current runtime, its flags, and its entry script. */
export function ovldSelfInvocation(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
  execArgv: string[] = process.execArgv
): { program: string; args: string[] } {
  const entry = argv[1];
  return entry ? { program: execPath, args: [...execArgv, entry] } : { program: 'ovld', args: [] };
}

export function supervisorArgs({
  contextFile,
  workingDirectory,
  model,
  effort,
  settings,
  codexBin
}: {
  contextFile: string;
  workingDirectory: string;
  model?: string | null;
  effort?: string | null;
  settings: CodexThreadLaunchSettings;
  codexBin?: string | null;
}): string[] {
  return [
    'agent-session',
    'sidecar',
    '--agent',
    CODEX_APP_SERVER_ADAPTER_KEY,
    '--prompt-file',
    contextFile,
    '--working-directory',
    workingDirectory,
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(settings.approvalPolicy ? ['--approval-policy', settings.approvalPolicy] : []),
    ...(settings.sandbox ? ['--sandbox', settings.sandbox] : []),
    ...(codexBin ? ['--codex-bin', codexBin] : [])
  ];
}

export function attachArgs(channelId: string): string[] {
  return ['agent-session', 'attach', '--channel-id', channelId];
}

/** The argv a person (or the terminal) runs to watch and drive a running session. */
export function codexRemoteResumeArgs({
  socketPath,
  threadId
}: {
  socketPath: string;
  threadId: string;
}): string[] {
  return ['--remote', `unix://${socketPath}`, 'resume', threadId];
}

export type CodexBinary = { path: string; version: string | null };

/**
 * Find the `codex` the supervisor will spawn. A runner service starts with a sparse PATH, so a
 * bare `codex` that fails is looked up again through the user's interactive login shell, which
 * is where a terminal launch would have found it.
 */
export function resolveCodexBinary({
  env = process.env,
  run = spawnSync
}: {
  env?: NodeJS.ProcessEnv;
  run?: typeof spawnSync;
} = {}): CodexBinary | null {
  const version = (bin: string): string | null => {
    const result = run(bin, ['--version'], { encoding: 'utf8', env, timeout: 10_000 });
    return result.status === 0 ? parseCliVersion(String(result.stdout)) : null;
  };
  const direct = version('codex');
  if (direct) return { path: 'codex', version: direct };
  const shell = env.SHELL?.trim() || '/bin/zsh';
  const lookup = run(shell, ['-ilc', 'command -v codex'], {
    encoding: 'utf8',
    env,
    timeout: 15_000
  });
  const resolved = String(lookup.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('/'))
    .at(-1);
  if (lookup.status !== 0 || !resolved) return null;
  return { path: resolved, version: version(resolved) };
}

export type CodexAppServerPreflight =
  | { ok: true; codex: CodexBinary }
  | { ok: false; warning: string };

/** Refuse app-server mode (the caller falls back to hooks) when Codex is missing or too old. */
export function preflightCodexAppServer(
  resolve: () => CodexBinary | null = resolveCodexBinary
): CodexAppServerPreflight {
  const codex = resolve();
  if (!codex) {
    return {
      ok: false,
      warning:
        'Codex app-server mode is selected, but `codex` was not found on this machine; ' +
        'launching in the terminal (hooks) instead.'
    };
  }
  if (!isSupportedVersion(codex.version)) {
    return {
      ok: false,
      warning:
        `Codex app-server mode needs codex ${CODEX_APP_SERVER_MIN_VERSION} or newer ` +
        `(found ${codex.version ?? 'an unknown version'}); launching in the terminal (hooks) ` +
        'instead. Upgrade Codex to use app-server mode.'
    };
  }
  return { ok: true, codex };
}

export type MintedLaunchChannel = { channelId: string; token: string; expiresAt: string };

/**
 * Mint the session channel this launch's supervisor posts through
 * (`POST /api/objectives/{id}/session-channels`, ADR 0092). The token is returned to the caller
 * only to stage in the owner-only credential cache.
 */
export async function mintCodexLaunchChannel({
  backend,
  objectiveRef,
  adapterVersion,
  executionRequestId,
  executionTargetId
}: {
  backend: BackendClient;
  objectiveRef: string;
  adapterVersion: string;
  executionRequestId?: string | null;
  executionTargetId?: string | null;
}): Promise<MintedLaunchChannel> {
  const minted = await backend.post<{ channelId?: unknown; token?: unknown; expiresAt?: unknown }>({
    path: `/api/objectives/${encodeURIComponent(objectiveRef)}/session-channels`,
    body: {
      adapterKey: CODEX_APP_SERVER_ADAPTER_KEY,
      adapterVersion,
      ...(executionRequestId ? { executionRequestId } : {}),
      ...(executionTargetId ? { executionTargetId } : {})
    }
  });
  if (typeof minted?.channelId !== 'string' || typeof minted.token !== 'string') {
    throw new Error('the backend returned no session channel');
  }
  return {
    channelId: minted.channelId,
    token: minted.token,
    expiresAt: typeof minted.expiresAt === 'string' ? minted.expiresAt : ''
  };
}

/**
 * Start the supervisor detached from the launching process, so it outlives the runner's claim,
 * the terminal and the TUI. Project pre-launch commands run first, in the user's login shell, as
 * they would before a terminal agent (`;`-joined: a failing line does not stop the launch).
 * Output goes to an owner-only log in the session scratch directory.
 */
export function startCodexSupervisorDetached({
  program,
  args,
  cwd,
  env,
  logFile,
  preLaunchCommands = [],
  spawnImpl,
  runImpl = spawnSync
}: {
  program: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
  preLaunchCommands?: string[];
  spawnImpl?: typeof spawn;
  runImpl?: typeof spawnSync;
}): { pid: number | null } {
  const logFd = openSync(logFile, 'a', 0o600);
  try {
    fchmodSync(logFd, 0o600);
    const pre = preLaunchCommands.map(command => command.trim()).filter(Boolean);
    if (pre.length > 0) {
      const shell = env.SHELL?.trim() || '/bin/bash';
      runImpl(shell, ['-ilc', pre.join('; ')], {
        cwd,
        env,
        stdio: ['ignore', logFd, logFd],
        timeout: 30 * 60 * 1000
      });
    }
    const child = (spawnImpl ?? spawn)(program, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });
    child.on('error', () => undefined);
    child.unref();
    return { pid: child.pid ?? null };
  } finally {
    closeSync(logFd);
  }
}

/**
 * The supervisor's environment: the launch environment, with the feature flag set, the raw
 * channel credential removed (the supervisor reads it from the owner-only cache) and the
 * person's user token removed. The supervisor talks to Overlord only through the channel
 * credential, and a long-lived process's environment is readable by any same-user process
 * (`ps eww`). The supervisor itself filters what reaches the app server (`buildServerEnv`).
 */
const SUPERVISOR_DROPPED_ENV = [
  'OVERLORD_SESSION_CHANNEL_TOKEN',
  'OVERLORD_USER_TOKEN',
  'OVLD_USER_TOKEN',
  'USER_TOKEN'
] as const;

export function supervisorEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, [CODEX_APP_SERVER_FLAG_ENV]: '1' };
  for (const key of SUPERVISOR_DROPPED_ENV) delete env[key];
  return env;
}
