import { spawnSync } from 'node:child_process';

import { codexRemoteResumeArgs } from './launch.js';
import {
  type CodexSessionState,
  isProcessAlive,
  listSessionStates,
  readSessionState
} from './state.js';
import { resolveSocketTarget } from './transport.js';

/**
 * `ovld agent-session attach` — open a terminal on a running Overlord-driven Codex session.
 *
 * It runs `codex --remote unix://<socket> resume <thread>` against the session's private app
 * server (spike §3.5, LIVE on 0.170). The TUI is one more client of the thread: it shows pending
 * approvals, and whichever of it and Overlord answers first wins. Closing the TUI leaves the
 * session running, because the supervisor and server own it; attach again to come back.
 *
 * The launch terminal runs this right after starting the supervisor, so it waits for the thread
 * to become resumable (its rollout exists once the first turn has started).
 */

export type AttachTarget = { state: CodexSessionState; socketPath: string; threadId: string };

export type FindAttachResult =
  | { ok: true; target: AttachTarget }
  | { ok: false; reason: 'not-found' | 'ended' | 'not-ready' | 'ambiguous'; detail: string };

export function findAttachTarget({
  channelId,
  objectiveId,
  home,
  isAlive = isProcessAlive
}: {
  channelId?: string | null;
  objectiveId?: string | null;
  home?: string;
  isAlive?: (pid: number | null) => boolean;
}): FindAttachResult {
  let state: CodexSessionState | null = null;
  if (channelId) {
    state = readSessionState(channelId, home);
  } else {
    const live = listSessionStates(home).filter(
      entry =>
        isAlive(entry.supervisorPid) &&
        (!objectiveId ||
          entry.objectiveId === objectiveId ||
          entry.objectiveId?.endsWith(`.${objectiveId}`))
    );
    if (live.length > 1 && !objectiveId) {
      return {
        ok: false,
        reason: 'ambiguous',
        detail:
          `${live.length} Codex app-server sessions are running on this machine; pass ` +
          `--objective-id or --channel-id. Running: ${live
            .map(entry => entry.objectiveId ?? entry.channelId)
            .join(', ')}`
      };
    }
    state = live[0] ?? null;
  }
  if (!state) {
    return {
      ok: false,
      reason: 'not-found',
      detail: 'No running Codex app-server session matches on this machine.'
    };
  }
  if (!isAlive(state.supervisorPid)) {
    return { ok: false, reason: 'ended', detail: 'That Codex app-server session has ended.' };
  }
  if (!state.socketPath || !state.threadId) {
    return {
      ok: false,
      reason: 'not-ready',
      detail: 'The session has not started its first turn yet.'
    };
  }
  return {
    ok: true,
    target: { state, socketPath: resolveSocketTarget(state.socketPath), threadId: state.threadId }
  };
}

/** Wait (polling the state file) until the session can be attached to, or the wait runs out. */
export async function waitForAttachTarget({
  channelId,
  objectiveId,
  waitMs,
  home,
  pollMs = 250,
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  now = () => Date.now()
}: {
  channelId?: string | null;
  objectiveId?: string | null;
  waitMs: number;
  home?: string;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<FindAttachResult> {
  const deadline = now() + Math.max(0, waitMs);
  for (;;) {
    const found = findAttachTarget({
      ...(channelId ? { channelId } : {}),
      ...(objectiveId ? { objectiveId } : {}),
      ...(home ? { home } : {})
    });
    // "not-found" is retried too: the launch terminal can start before the supervisor has
    // written its state file.
    const retryable = !found.ok && (found.reason === 'not-ready' || found.reason === 'not-found');
    if (found.ok || !retryable || now() >= deadline) return found;
    await sleep(pollMs);
  }
}

/** Run the Codex TUI against the session. Returns the TUI's exit status. */
export function runCodexRemoteTui({
  target,
  codexBin = 'codex',
  env = process.env
}: {
  target: AttachTarget;
  codexBin?: string;
  env?: NodeJS.ProcessEnv;
}): number {
  const result = spawnSync(
    codexBin,
    codexRemoteResumeArgs({ socketPath: target.socketPath, threadId: target.threadId }),
    { cwd: target.state.cwd, env, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}
