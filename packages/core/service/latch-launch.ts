/**
 * Latch create-then-open helpers (coo:702).
 *
 * Pure manifest / response / provider-session mapping logic. The CLI runner
 * owns the actual `latch create` / `latch open` process spawns; this module
 * never installs Latch and never treats a Latch session id as a credential.
 */

import type { TerminalViewerKind } from './terminal-profile-types.ts';

/** Latch launch-manifest schema version Overlord speaks today. */
export const LATCH_MANIFEST_FORMAT_VERSION = 1;

/** Default PTY size when the host terminal size is unknown. */
export const DEFAULT_LATCH_TERMINAL_SIZE = { cols: 120, rows: 36 } as const;

/** Key under `execution_requests.metadata_json` holding the provider-session mapping. */
export const PROVIDER_SESSION_METADATA_KEY = 'providerSession';

export type LatchTerminalSize = {
  cols: number;
  rows: number;
};

/**
 * Latch wire-format launch manifest (snake_case). Matches
 * `latch create --manifest-file -` in the Latch CLI.
 */
export type LatchLaunchManifest = {
  format_version: number;
  launch: {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    inherit_env?: boolean;
    size: LatchTerminalSize;
  };
  display: {
    name?: string;
    title?: string;
    command_label?: string;
    source: {
      kind: string;
      external_run_id?: string;
    };
  };
};

/** Structured `latch create --json` response. */
export type LatchCreateReport = {
  protocolVersion: number;
  session: {
    id: string;
    name: string;
    state: string;
    createdAt: string;
  };
};

/**
 * External terminal-session mapping recorded after a successful Latch create.
 * Never a credential; never written to `launched_session_id`.
 */
export type ExecutionProviderSession = {
  provider: 'latch';
  providerSessionId: string;
  /** Display name returned by Latch; absent for inherited/pre-v73 mappings. */
  sessionName: string | null;
  executionTargetId: string | null;
  agentSessionId: string | null;
  createdAt: string;
  lastObservedState: string;
};

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Build the Latch create manifest. `commandString` is the same terminal inner
 * command S Overlord already composes (including `cd`); it is run through a
 * login shell so quoting / `&&` / multi-line pre-launch match iTerm/Terminal.
 */
export function buildLatchCreateManifest({
  commandString,
  shell = process.env.SHELL?.trim() || '/bin/bash',
  cwd,
  env,
  size = DEFAULT_LATCH_TERMINAL_SIZE,
  title,
  name,
  commandLabel,
  externalRunId
}: {
  commandString: string;
  shell?: string;
  cwd: string;
  env: Record<string, string>;
  size?: LatchTerminalSize;
  title?: string | null;
  name?: string | null;
  commandLabel?: string | null;
  externalRunId?: string | null;
}): LatchLaunchManifest {
  const shellPath = trimmed(shell) ?? '/bin/bash';
  const cleanedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.trim() && typeof value === 'string') cleanedEnv[key] = value;
  }

  const display: LatchLaunchManifest['display'] = {
    source: {
      kind: 'overlord',
      ...(trimmed(externalRunId) ? { external_run_id: trimmed(externalRunId)! } : {})
    }
  };
  if (trimmed(title)) display.title = trimmed(title)!;
  if (trimmed(name)) display.name = trimmed(name)!;
  if (trimmed(commandLabel)) display.command_label = trimmed(commandLabel)!;

  return {
    format_version: LATCH_MANIFEST_FORMAT_VERSION,
    launch: {
      argv: [shellPath, '-lc', commandString],
      cwd,
      env: cleanedEnv,
      inherit_env: true,
      size: {
        cols: Math.max(1, Math.floor(size.cols) || DEFAULT_LATCH_TERMINAL_SIZE.cols),
        rows: Math.max(1, Math.floor(size.rows) || DEFAULT_LATCH_TERMINAL_SIZE.rows)
      }
    },
    display
  };
}

/** Parse `latch create --json` stdout. Returns null when the document is unusable. */
export function parseLatchCreateReport(raw: string): LatchCreateReport | null {
  try {
    const parsed = JSON.parse(raw) as {
      protocolVersion?: unknown;
      session?: {
        id?: unknown;
        name?: unknown;
        state?: unknown;
        createdAt?: unknown;
      };
    };
    const id = trimmed(parsed.session?.id);
    if (!id) return null;
    const protocolVersion =
      typeof parsed.protocolVersion === 'number' && Number.isFinite(parsed.protocolVersion)
        ? parsed.protocolVersion
        : LATCH_MANIFEST_FORMAT_VERSION;
    return {
      protocolVersion,
      session: {
        id,
        name: trimmed(parsed.session?.name) ?? id,
        state: trimmed(parsed.session?.state) ?? 'running',
        createdAt: trimmed(parsed.session?.createdAt) ?? new Date().toISOString()
      }
    };
  } catch {
    return null;
  }
}

export function toExecutionProviderSession({
  createReport,
  executionTargetId,
  createdAt
}: {
  createReport: LatchCreateReport;
  executionTargetId?: string | null;
  createdAt?: string;
}): ExecutionProviderSession {
  return {
    provider: 'latch',
    providerSessionId: createReport.session.id,
    sessionName: createReport.session.name,
    executionTargetId: trimmed(executionTargetId),
    agentSessionId: null,
    createdAt: createdAt ?? createReport.session.createdAt,
    lastObservedState: createReport.session.state
  };
}

/**
 * Map the `LATCH_SESSION_ID` inherited from an existing Latch PTY to the
 * provider-session record for an inline launch. The marker correlates the run
 * with its terminal only; it is never an authorization credential.
 */
export function existingLatchProviderSession({
  latchSessionId,
  executionTargetId,
  createdAt = new Date().toISOString()
}: {
  latchSessionId: string | null | undefined;
  executionTargetId?: string | null;
  createdAt?: string;
}): ExecutionProviderSession | null {
  const providerSessionId = trimmed(latchSessionId);
  if (!providerSessionId) return null;
  return {
    provider: 'latch',
    providerSessionId,
    sessionName: null,
    executionTargetId: trimmed(executionTargetId),
    agentSessionId: null,
    createdAt,
    lastObservedState: 'running'
  };
}

/** Parse a provider-session mapping from a REST/JSON body or metadata blob. */
export function parseExecutionProviderSession(value: unknown): ExecutionProviderSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return providerSessionFromMetadata({ [PROVIDER_SESSION_METADATA_KEY]: value });
}

/** Read a provider-session mapping from execution-request metadata. */
export function providerSessionFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ExecutionProviderSession | null {
  const raw = metadata?.[PROVIDER_SESSION_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cast = raw as {
    provider?: unknown;
    providerSessionId?: unknown;
    sessionName?: unknown;
    executionTargetId?: unknown;
    agentSessionId?: unknown;
    createdAt?: unknown;
    lastObservedState?: unknown;
  };
  if (trimmed(cast.provider)?.toLowerCase() !== 'latch') return null;
  const providerSessionId = trimmed(cast.providerSessionId);
  if (!providerSessionId) return null;
  return {
    provider: 'latch',
    providerSessionId,
    sessionName: trimmed(cast.sessionName),
    executionTargetId: trimmed(cast.executionTargetId),
    agentSessionId: trimmed(cast.agentSessionId),
    createdAt: trimmed(cast.createdAt) ?? '',
    lastObservedState: trimmed(cast.lastObservedState) ?? 'running'
  };
}

/** Merge a provider-session mapping into execution-request metadata. */
export function mergeProviderSessionIntoMetadata({
  metadataJson,
  providerSession
}: {
  metadataJson: string | null | undefined;
  providerSession: ExecutionProviderSession;
}): string {
  let parsed: Record<string, unknown> = {};
  if (metadataJson?.trim()) {
    try {
      const value = JSON.parse(metadataJson) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }
  return JSON.stringify({
    ...parsed,
    [PROVIDER_SESSION_METADATA_KEY]: providerSession
  });
}

/**
 * Map Overlord's stored viewer kind to a Latch `--with` identifier.
 * Returns null when Latch has no matching viewer (open must be skipped / warned).
 */
export function latchViewerFlagForKind(
  kind: TerminalViewerKind | string | null | undefined
): string | null {
  switch (trimmed(kind)?.toLowerCase()) {
    case 'iterm':
    case 'iterm2':
      return 'iterm';
    default:
      return null;
  }
}

/** Attach command a human can run when viewer open fails or is skipped. */
export function latchAttachCommand({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string;
  providerSessionId: string;
}): string {
  return `${trimmed(executable) ?? 'latch'} attach ${providerSessionId}`;
}

/**
 * Decide whether this launch should use Latch create-then-open.
 * Pure: callers supply discovery + the claim-time snapshot.
 */
export function shouldUseLatchProvider({
  providerKind,
  latchSelectable
}: {
  providerKind: string | null | undefined;
  latchSelectable: boolean;
}): boolean {
  return trimmed(providerKind)?.toLowerCase() === 'latch' && latchSelectable === true;
}
