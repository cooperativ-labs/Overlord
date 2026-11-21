import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import { prepareSocketDirectory, socketDirectory } from './server.js';

/**
 * Local state for running Codex app-server sessions, one owner-only JSON file per session channel
 * in the same 0700 directory as the sockets (`~/.ovld/cx/`).
 *
 * It answers the questions launch, terminal attach and doctor ask on this machine:
 *  - which socket and thread a running session uses (`ovld agent-session attach`);
 *  - whether its supervisor is still alive, and which server it owns (orphan reaping);
 *  - which Codex trust entry Overlord caused for the session's directory (cleanup).
 *
 * It holds no credential. The channel credential lives in the credential cache
 * (`agent-session/channel.ts`); this file only names the channel. The file name is a hash of the
 * channel id so the directory listing does not enumerate channels.
 */

export const SESSION_STATE_VERSION = 1;

export type CodexSessionState = {
  version: number;
  channelId: string;
  missionId: string | null;
  objectiveId: string | null;
  cwd: string;
  socketPath: string | null;
  /** Set once the thread's rollout exists, so `codex --remote … resume <threadId>` can succeed. */
  threadId: string | null;
  supervisorPid: number;
  serverPid: number | null;
  codexVersion: string | null;
  /** The Codex trust entry `thread/start` wrote for `cwd`, recorded so it can be removed. */
  trustEntryAdded: string | null;
  startedAt: string;
  updatedAt: string;
  /** Set when the supervisor ended; the file is then removed. */
  endedReason?: string | null;
};

export function stateFileName(channelId: string): string {
  return `${createHash('sha256').update(channelId).digest('hex').slice(0, 16)}.json`;
}

export function stateFilePath(channelId: string, home?: string): string {
  return path.join(socketDirectory(home), stateFileName(channelId));
}

export function writeSessionState(state: CodexSessionState, home?: string): void {
  const dir = prepareSocketDirectory(home);
  const filePath = path.join(dir, stateFileName(state.channelId));
  const temp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, filePath);
}

function parseState(text: string): CodexSessionState | null {
  try {
    const value = JSON.parse(text) as Partial<CodexSessionState>;
    if (
      !value ||
      typeof value.channelId !== 'string' ||
      typeof value.cwd !== 'string' ||
      typeof value.supervisorPid !== 'number'
    ) {
      return null;
    }
    return {
      version: typeof value.version === 'number' ? value.version : SESSION_STATE_VERSION,
      channelId: value.channelId,
      missionId: typeof value.missionId === 'string' ? value.missionId : null,
      objectiveId: typeof value.objectiveId === 'string' ? value.objectiveId : null,
      cwd: value.cwd,
      socketPath: typeof value.socketPath === 'string' ? value.socketPath : null,
      threadId: typeof value.threadId === 'string' ? value.threadId : null,
      supervisorPid: value.supervisorPid,
      serverPid: typeof value.serverPid === 'number' ? value.serverPid : null,
      codexVersion: typeof value.codexVersion === 'string' ? value.codexVersion : null,
      trustEntryAdded: typeof value.trustEntryAdded === 'string' ? value.trustEntryAdded : null,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      endedReason: typeof value.endedReason === 'string' ? value.endedReason : null
    };
  } catch {
    return null;
  }
}

export function readSessionState(channelId: string, home?: string): CodexSessionState | null {
  try {
    return parseState(readFileSync(stateFilePath(channelId, home), 'utf8'));
  } catch {
    return null;
  }
}

export function removeSessionState(channelId: string, home?: string): void {
  rmSync(stateFilePath(channelId, home), { force: true });
}

/** Every readable session state on this machine, newest first. */
export function listSessionStates(home?: string): CodexSessionState[] {
  const dir = socketDirectory(home);
  if (!existsSync(dir)) return [];
  const states: CodexSessionState[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const state = parseState(readFileSync(path.join(dir, name), 'utf8'));
      if (state) states.push(state);
    } catch {
      // Unreadable: not ours to judge.
    }
  }
  return states.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** True when a process with this pid exists (signal 0 probes without signalling). */
export function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A pid can be reused once its process exits, so an orphan is killed only when the process
 * holding that pid is still a Codex app server.
 */
export function isCodexAppServerProcess(pid: number): boolean {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.status !== 0) return false;
  const command = String(result.stdout).trim();
  return /\bcodex\b/.test(command) && command.includes('app-server');
}

export type ReapResult = { channelId: string; killedServerPid: number | null };

/**
 * Stop app servers whose supervisor is gone (it was killed with SIGKILL, or the machine slept
 * through its exit handler) and remove their sockets and state. Runs at every supervisor start
 * and from `ovld doctor`. `cleanup` is called with each reaped state so the caller can undo the
 * trust entry it recorded.
 */
export function reapOrphanedSessions({
  home,
  isAlive = isProcessAlive,
  isAppServer = isCodexAppServerProcess,
  kill = (pid: number, signal: NodeJS.Signals) => process.kill(pid, signal),
  cleanup
}: {
  home?: string;
  isAlive?: (pid: number | null) => boolean;
  isAppServer?: (pid: number) => boolean;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  cleanup?: (state: CodexSessionState) => void;
} = {}): ReapResult[] {
  const reaped: ReapResult[] = [];
  for (const state of listSessionStates(home)) {
    if (state.supervisorPid === process.pid || isAlive(state.supervisorPid)) continue;
    let killedServerPid: number | null = null;
    if (state.serverPid && isAlive(state.serverPid) && isAppServer(state.serverPid)) {
      try {
        // The server runs in its own process group; take its children with it.
        kill(-state.serverPid, 'SIGKILL');
        killedServerPid = state.serverPid;
      } catch {
        // Already gone.
      }
    }
    if (state.socketPath) rmSync(state.socketPath, { force: true });
    try {
      cleanup?.(state);
    } catch {
      // Cleanup is best effort; the state file still goes.
    }
    removeSessionState(state.channelId, home);
    reaped.push({ channelId: state.channelId, killedServerPid });
  }
  return reaped;
}

/**
 * `ovld doctor`'s view of Codex harness modes on this machine (ADR 0092). Purely local: it reads
 * the owner-only state directory and probes pids. Every running app-server session is listed with
 * the objective it serves and how to attach to it; every other Codex session is a hooks session.
 * Orphans (supervisor gone, server still running) are reaped first, the same way a supervisor
 * start reaps them.
 */
export function describeCodexHarnessSessions({
  home,
  reap = true,
  cleanup,
  isAlive = isProcessAlive
}: {
  home?: string;
  reap?: boolean;
  cleanup?: (state: CodexSessionState) => void;
  isAlive?: (pid: number | null) => boolean;
} = {}): { detail: string; reaped: number; running: number } {
  const reaped = reap
    ? reapOrphanedSessions({ ...(home ? { home } : {}), ...(cleanup ? { cleanup } : {}) }).length
    : 0;
  const running = listSessionStates(home).filter(state => isAlive(state.supervisorPid));
  const parts = running.map(
    state =>
      `${state.objectiveId ?? state.channelId}: app-server (codex ${state.codexVersion ?? '?'}, ` +
      `thread ${state.threadId ? state.threadId.slice(0, 13) : 'starting'}; attach with ` +
      `\`ovld agent-session attach --channel-id ${state.channelId}\`)`
  );
  const head =
    running.length === 0
      ? 'no Codex app-server sessions running; Codex sessions on this machine use the hooks adapter'
      : `${running.length} Codex app-server session(s) running; other Codex sessions use the hooks adapter`;
  const tail = reaped > 0 ? [`reaped ${reaped} orphaned app server(s)`] : [];
  return { detail: [head, ...parts, ...tail].join('; '), reaped, running: running.length };
}
