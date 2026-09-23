/**
 * Latch create-then-open helpers (coo:702).
 *
 * Pure manifest / response / provider-session mapping logic. The CLI runner
 * owns the actual `latch create` / `latch open` process spawns; this module
 * never installs Latch and never treats a Latch session id as a credential.
 */

import path from 'node:path';

import type { TerminalViewerKind, ViewerOpenAs } from './terminal-profile-types.ts';
import { parseViewerOpenAs } from './terminal-profile-types.ts';

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

export type LatchAgentLaunch = {
  agent: 'claude' | 'codex';
  argv: string[];
  prelude?: string;
};

/** Older Latch builds silently ignore the structured agent fields. */
export const LATCH_AGENT_LAUNCH_EXTENSION = 'agent-launch';

/** Preserve opaque wrappers and non-agent launches on the original shell path. */
export function selectLatchAgentLaunch({
  agent,
  argv,
  preCommand,
  preLaunchCommands,
  extensions,
  shell
}: {
  agent: string;
  argv: string[];
  preCommand?: string | null;
  preLaunchCommands?: string[] | null;
  extensions: string[];
  shell: string;
}): LatchAgentLaunch | null {
  if (!extensions.includes(LATCH_AGENT_LAUNCH_EXTENSION)) return null;
  if (agent !== 'claude' && agent !== 'codex') return null;
  if (preCommand?.trim() || !path.isAbsolute(shell)) return null;
  if (path.basename(argv[0] ?? '') !== agent) return null;
  const prelude = (preLaunchCommands ?? [])
    .map(command => command.trim())
    .filter(Boolean)
    .join('; ');
  return { agent, argv, ...(prelude ? { prelude } : {}) };
}

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
    agent?: 'claude' | 'codex';
    login_shell?: { path: string; prelude?: string };
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

/** Latch display identity for an objective-scoped session. */
export function formatObjectiveLatchDisplay({
  objectiveDisplayId,
  objectiveTitle
}: {
  objectiveDisplayId: string;
  objectiveTitle?: string | null;
}): { name: string; title: string } {
  const name = objectiveDisplayId.trim();
  const titlePart = objectiveTitle?.trim() || '';
  return {
    name,
    title: titlePart ? `${name} — ${titlePart}` : name
  };
}

/**
 * Build the Latch create manifest. A supported agent is passed as structured
 * argv so Latch can prepare its connector before wrapping it in a login shell.
 * Other launches keep the original terminal command string S.
 */
export function buildLatchCreateManifest({
  commandString,
  agentLaunch,
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
  agentLaunch?: LatchAgentLaunch | null;
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
  if (agentLaunch && path.basename(agentLaunch.argv[0] ?? '') !== agentLaunch.agent) {
    throw new Error('Latch agent launch argv must start with the declared agent executable');
  }
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
      argv: agentLaunch ? [...agentLaunch.argv] : [shellPath, '-ilc', commandString],
      cwd,
      env: cleanedEnv,
      inherit_env: true,
      size: {
        cols: Math.max(1, Math.floor(size.cols) || DEFAULT_LATCH_TERMINAL_SIZE.cols),
        rows: Math.max(1, Math.floor(size.rows) || DEFAULT_LATCH_TERMINAL_SIZE.rows)
      },
      ...(agentLaunch
        ? {
            agent: agentLaunch.agent,
            login_shell: {
              path: shellPath,
              ...(agentLaunch.prelude ? { prelude: agentLaunch.prelude } : {})
            }
          }
        : {})
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
 * Drop the Latch provider-session mapping while leaving the rest of the
 * execution-request metadata (claim-time launchSession snapshot, etc.) intact.
 * Used when Latch has already reclaimed the session; Overlord does not keep a
 * tombstone card.
 */
export function stripProviderSessionFromMetadata({
  metadataJson
}: {
  metadataJson: string | null | undefined;
}): string {
  let parsed: Record<string, unknown> = {};
  if (metadataJson?.trim()) {
    try {
      const value = JSON.parse(metadataJson) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = { ...(value as Record<string, unknown>) };
      }
    } catch {
      parsed = {};
    }
  }
  delete parsed[PROVIDER_SESSION_METADATA_KEY];
  return JSON.stringify(parsed);
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

/**
 * First Latch product version whose `latch open` accepts `--as window|tab`.
 *
 * This is a version gate rather than a capability flag because `latch
 * capabilities` does not advertise individual flags, and clap rejects an
 * unknown argument outright — sending `--as` to an older CLI would fail the
 * open entirely instead of degrading to a new window.
 */
export const LATCH_OPEN_AS_MIN_PRODUCT_VERSION = '0.2608140931.0';

/**
 * Compare two dotted-numeric Latch product versions (`0.2608140931.0`).
 * Returns <0, 0, or >0. Non-numeric or missing segments compare as 0, so a
 * version string Overlord cannot read never falsely satisfies a minimum.
 */
export function compareLatchProductVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value
      .trim()
      .split('.')
      .map(segment => {
        const parsed = Number.parseInt(segment, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether this Latch build understands `latch open --as`. Unknown / unparseable
 * versions answer `false`: omitting the flag opens a window, which is the same
 * thing an older Latch would have done anyway.
 */
export function latchSupportsOpenAs(productVersion: string | null | undefined): boolean {
  const version = trimmed(productVersion);
  if (!version) return false;
  return compareLatchProductVersions(version, LATCH_OPEN_AS_MIN_PRODUCT_VERSION) >= 0;
}

/** First Latch product version whose `latch open` accepts `--background` / `--foreground`. */
export const LATCH_OPEN_BACKGROUND_MIN_PRODUCT_VERSION = '0.2609181007.0';

/**
 * Whether this Latch build understands `latch open --background`. Unknown /
 * unparseable versions answer `false`: clap rejects unknown flags, and a viewer
 * that opens in the foreground is better than one that fails to open.
 */
export function latchSupportsOpenBackground(productVersion: string | null | undefined): boolean {
  const version = trimmed(productVersion);
  if (!version) return false;
  return compareLatchProductVersions(version, LATCH_OPEN_BACKGROUND_MIN_PRODUCT_VERSION) >= 0;
}

/**
 * Build the argv for `latch open`.
 *
 * `--as` is sent explicitly whenever the CLI supports it, never left to Latch's
 * own stored `open.behavior` default: Overlord holds this preference itself, and
 * two independent defaults that disagree give the user no way to tell which one
 * won.
 */
export function buildLatchOpenArgs({
  providerSessionId,
  viewer,
  openAs,
  background,
  productVersion
}: {
  providerSessionId: string;
  viewer: string;
  openAs?: ViewerOpenAs | string | null;
  /**
   * Focus preference. `undefined`/`null` sends neither flag (Latch's own
   * `open.background` decides); a boolean is sent explicitly for the same
   * reason `--as` is — Overlord's visible setting should be the one that wins.
   */
  background?: boolean | null;
  productVersion?: string | null;
}): string[] {
  const args = ['open', providerSessionId, '--with', viewer];
  if (openAs && latchSupportsOpenAs(productVersion)) {
    args.push('--as', parseViewerOpenAs(openAs));
  }
  if (typeof background === 'boolean' && latchSupportsOpenBackground(productVersion)) {
    args.push(background ? '--background' : '--foreground');
  }
  args.push('--json');
  return args;
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
