import { readFileSync } from 'node:fs';

import { captureChangeFromPayload } from '../../capture-change.js';
import { removeNativeSessionIndex, writeNativeSessionIndex } from '../../hook-binding.js';
import { getCliVersion } from '../../version.js';
import { resolveAgentSessionScope } from '../bind.js';
import { removeChannelCredential } from '../channel.js';
import { createChannelClient } from '../client.js';
import { findAgentSessionCodec } from '../codec-registry.generated.js';

import type { ProjectedFrame } from './events.js';
import type { CodexApprovalPolicy, CodexSandboxMode } from './launch.js';
import {
  CODEX_APP_SERVER_ADAPTER_KEY,
  CODEX_APP_SERVER_FLAG_ENV,
  isSupportedVersion
} from './protocol.js';
import { type PrivateAppServer, readCodexVersion, spawnPrivateAppServer } from './server.js';
import {
  type CodexSessionState,
  reapOrphanedSessions,
  removeSessionState,
  SESSION_STATE_VERSION,
  writeSessionState
} from './state.js';
import { runCodexAppServerSupervisor, type SupervisorResult } from './supervisor.js';
import { connectWebSocket } from './transport.js';
import { addedTrustEntry, removeImplicitTrustEntry, snapshotTrustEntries } from './trust.js';

/**
 * Entry point for `ovld agent-session sidecar --agent codex-app-server`.
 *
 * Order is the security property, as for every adapter entry point:
 *   scope gate → feature flag → backend → codec → version gate → server → supervisor.
 * An unbound process (no channel credential) does nothing observable: no spawn, no socket, no
 * network call.
 *
 * Launch starts this detached when a Codex objective runs in app-server mode (ADR 0092): launch
 * mints the channel, stages its credential in the owner-only cache and sets
 * `OVERLORD_CODEX_APP_SERVER=1` for this process. Run by hand, the flag is still required.
 *
 * ## Server lifecycle (one private server per session)
 *  - Before spawning, orphans are reaped: a server whose supervisor died without cleaning up is
 *    stopped and its socket, state and trust entry removed.
 *  - The session's socket, thread and pids are written to an owner-only state file so
 *    `ovld agent-session attach` can open the terminal and doctor can report the session.
 *  - A server that crashes is respawned (up to {@link MAX_SERVER_RESTARTS} times) and the
 *    supervisor resumes the thread on it; pending approvals are replayed by Codex.
 *  - When the thread is ready it is indexed under the `codex` agent (the native-session index
 *    `attach` writes), so the Codex status line provider, which runs inside this server's
 *    allowlisted environment with no launch binding, can show the session's mission and
 *    objective for that thread (`terminal.statusSurface`). The entry is removed on exit.
 *  - On exit the server is stopped, the trust entry `thread/start` added for the working
 *    directory is removed, and the state file and channel credential cache are deleted.
 */

/** The hooks/status-line agent key whose native-session index names an app-server thread. */
const STATUS_LINE_INDEX_AGENT = 'codex';

type ThreadBinding = Pick<CodexSessionState, 'cwd' | 'missionId' | 'objectiveId'>;

/** Index the session's thread so the Codex status line provider can find its objective. */
export function indexThreadForStatusLine(state: ThreadBinding, threadId: string): void {
  if (!state.missionId || !state.objectiveId) return;
  writeNativeSessionIndex({
    agent: STATUS_LINE_INDEX_AGENT,
    nativeSessionId: threadId,
    workingDirectory: state.cwd,
    missionId: state.missionId,
    objectiveId: state.objectiveId
  });
}

/** Remove that entry, only while it still names this session's objective. */
export function unindexThreadForStatusLine(state: ThreadBinding, threadId: string | null): void {
  if (!threadId || !state.objectiveId) return;
  removeNativeSessionIndex({
    agent: STATUS_LINE_INDEX_AGENT,
    nativeSessionId: threadId,
    objectiveIds: [state.objectiveId]
  });
}

const MAX_SERVER_RESTARTS = 3;

/** Sent as a new turn after a crashed server is replaced and the thread resumed idle. */
export const RESTART_CONTINUATION_PROMPT =
  'The Codex app server running this Overlord session restarted and interrupted your last turn. ' +
  'Continue the current objective from where you left off.';

export type CodexSidecarResult =
  | { reason: 'no-scope' | 'flag-off' | 'no-backend' | 'no-codec' }
  | { reason: 'version-unsupported'; serverVersion: string | null }
  | { reason: 'server-failed'; detail: string }
  | (SupervisorResult & { serverRestarts: number; trustEntryRemoved: boolean });

export async function runCodexAppServerSidecar({
  env = process.env,
  cwd = process.cwd(),
  socketPath = null,
  threadId = null,
  promptFile = null,
  codexBin = 'codex',
  model = null,
  effort = null,
  approvalPolicy = null,
  sandbox = null,
  home
}: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Connect to an existing private server instead of spawning one. */
  socketPath?: string | null;
  threadId?: string | null;
  promptFile?: string | null;
  codexBin?: string;
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  sandbox?: CodexSandboxMode | null;
  /** Home directory for the socket/state directory (tests). */
  home?: string;
}): Promise<CodexSidecarResult> {
  const scope = resolveAgentSessionScope({ agent: CODEX_APP_SERVER_ADAPTER_KEY, env });
  if (!scope) return { reason: 'no-scope' };
  if (env[CODEX_APP_SERVER_FLAG_ENV]?.trim() !== '1') return { reason: 'flag-off' };
  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl) return { reason: 'no-backend' };
  const codec = findAgentSessionCodec(CODEX_APP_SERVER_ADAPTER_KEY);
  if (!codec) return { reason: 'no-codec' };

  const cleanupTrust = (state: CodexSessionState): void => {
    if (state.trustEntryAdded) removeImplicitTrustEntry(state.trustEntryAdded, env);
  };
  try {
    reapOrphanedSessions({ ...(home ? { home } : {}), cleanup: cleanupTrust });
  } catch {
    // Reaping is housekeeping; it never blocks a launch.
  }

  let codexVersion: string | null = null;
  let server: PrivateAppServer | null = null;
  let serverRestarts = 0;
  if (!socketPath) {
    codexVersion = readCodexVersion(codexBin, env);
    if (!isSupportedVersion(codexVersion)) {
      return { reason: 'version-unsupported', serverVersion: codexVersion };
    }
    try {
      server = await spawnPrivateAppServer({ codexBin, cwd, env, ...(home ? { home } : {}) });
    } catch (error) {
      return {
        reason: 'server-failed',
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const startedAt = new Date().toISOString();
  const state: CodexSessionState = {
    version: SESSION_STATE_VERSION,
    channelId: scope.channelId,
    missionId: env.OVERLORD_MISSION_ID?.trim() || env.MISSION_ID?.trim() || null,
    objectiveId: env.OVERLORD_OBJECTIVE_ID?.trim() || null,
    cwd,
    socketPath: server?.socketPath ?? socketPath,
    threadId: null,
    supervisorPid: process.pid,
    serverPid: server?.child.pid ?? null,
    codexVersion,
    trustEntryAdded: null,
    startedAt,
    updatedAt: startedAt
  };
  const saveState = (): void => {
    try {
      writeSessionState({ ...state, updatedAt: new Date().toISOString() }, home);
    } catch {
      // Without a state file the session still runs; only terminal attach and doctor lose it.
    }
  };
  saveState();

  // Trust: remember whether the working directory already had a Codex project entry, so the one
  // `thread/start` adds can be removed again (and nothing else ever is).
  const trustBefore = threadId ? null : snapshotTrustEntries(cwd, env);

  const client = createChannelClient({ baseUrl, channelId: scope.channelId, token: scope.token });
  const objectiveId = state.objectiveId;
  const capture = objectiveId
    ? (frame: ProjectedFrame) => {
        if (
          frame.event !== 'item/completed:fileChange' &&
          frame.event !== 'item/completed:commandExecution'
        ) {
          return;
        }
        captureChangeFromPayload({
          agent: CODEX_APP_SERVER_ADAPTER_KEY,
          rawPayload: JSON.stringify(frame),
          objectiveOverride: objectiveId,
          fallbackCwd: cwd
        });
      }
    : undefined;

  let pendingContinuation = false;
  /** Connect to the session's server, respawning it first when it has exited. */
  const connect = async () => {
    // A server killed by a signal has `exitCode === null` and a `signalCode`.
    if (server && (server.child.exitCode !== null || server.child.signalCode !== null)) {
      if (serverRestarts >= MAX_SERVER_RESTARTS) throw new Error('app server restart limit');
      serverRestarts += 1;
      pendingContinuation = true;
      await server.stop();
      server = await spawnPrivateAppServer({ codexBin, cwd, env, ...(home ? { home } : {}) });
      state.socketPath = server.socketPath;
      state.serverPid = server.child.pid ?? null;
      saveState();
    }
    const target = server?.socketPath ?? socketPath;
    if (!target) throw new Error('no app server socket');
    return connectWebSocket({ kind: 'unix', socketPath: target });
  };

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  process.once('SIGHUP', onSignal);
  let trustEntryRemoved = false;
  let result: SupervisorResult;
  try {
    result = await runCodexAppServerSupervisor({
      codec,
      client,
      connect,
      cwd,
      clientVersion: getCliVersion(),
      threadId,
      firstPrompt: promptFile ? readFileSync(promptFile, 'utf8') : null,
      threadSettings: { model, effort, approvalPolicy, sandbox },
      ...(capture ? { capture } : {}),
      // A resumed or respawned thread imports what it did while disconnected (subagents too).
      importHistory: true,
      stopSignal: controller.signal,
      consumeContinuationPrompt: () => {
        if (!pendingContinuation) return null;
        pendingContinuation = false;
        return RESTART_CONTINUATION_PROMPT;
      },
      onThreadReady: id => {
        indexThreadForStatusLine(state, id);
        state.threadId = id;
        if (trustBefore && !state.trustEntryAdded) {
          state.trustEntryAdded = addedTrustEntry(trustBefore, env);
        }
        saveState();
      }
    });
    if (result.reason !== 'channel-ended') {
      await client.post('/end', { reason: `codex_app_server_${result.reason.replace(/-/g, '_')}` });
    }
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    process.off('SIGHUP', onSignal);
    const current = server as PrivateAppServer | null;
    if (current) await current.stop();
    // Late detection: the thread may have ended before it was ever reported ready.
    if (trustBefore && !state.trustEntryAdded) {
      state.trustEntryAdded = addedTrustEntry(trustBefore, env);
    }
    if (state.trustEntryAdded) {
      trustEntryRemoved = removeImplicitTrustEntry(state.trustEntryAdded, env) === 'removed';
    }
    unindexThreadForStatusLine(state, state.threadId);
    removeSessionState(scope.channelId, home);
    // The server revoked the credential when the channel ended; the cache copy is now inert.
    removeChannelCredential(scope.channelId);
  }
  return { ...result, serverRestarts, trustEntryRemoved };
}
