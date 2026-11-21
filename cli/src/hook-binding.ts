import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';
import { readBoundedUtf8File, writeOwnerOnlyFileAtomically } from './local-file-storage.js';
import { readCachedSessionKey } from './session-key.js';

/**
 * Hook binding: which mission, objective and protocol session a native hook call belongs to.
 *
 * This replaces the cwd-keyed temp file that the shell hooks read and nothing ever wrote. One
 * resolver serves the CLI fallback (`ovld protocol hook-event --agent <key> --payload-file -`) and
 * the `mcp_tool` hook path, which spawns that same command. The authority rules are unchanged:
 *
 * - the launch environment names the mission and objective when Overlord launched the session;
 * - otherwise the **native-session index** may locate a binding that `attach` already made for
 *   this harness conversation. The index is a lookup alias, never a grant. The protocol session
 *   key it leads to still comes from the owner-only session-key cache that attach wrote;
 * - the working directory never selects a binding, because two agents can share a checkout.
 *
 * The index never feeds `capture-change`: file capture keeps requiring an explicit objective
 * identity from the launch environment.
 */

const INDEX_DIR = 'native-session-index';
const TURN_DIR = 'hook-turn-index';
const STOP_REMINDER_DIR = 'hook-stop-reminders';
const PROMPT_DIR = 'hook-last-prompt';
const MAX_INDEX_FILE_BYTES = 4096;

export type NativeSessionIndexEntry = {
  agent: string;
  workingDirectory: string;
  missionId: string;
  objectiveId: string;
};

export type HookBinding = {
  missionId: string;
  objectiveId: string | null;
  sessionKey: string | null;
  workingDirectory: string;
  source: 'env' | 'native-session-index';
};

function digest(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

/** `<global data dir>/native-session-index/<sha256(agent \0 native id)>`. */
export function nativeSessionIndexPath({
  agent,
  nativeSessionId,
  dataDir = resolveGlobalDataDir()
}: {
  agent: string;
  nativeSessionId: string;
  dataDir?: string;
}): string {
  return path.join(dataDir, INDEX_DIR, digest(`${agent.toLowerCase()}\0${nativeSessionId}`));
}

/** Written by attach. Holds no secret: the session key stays in the session-key cache. */
export function writeNativeSessionIndex(
  entry: NativeSessionIndexEntry & { nativeSessionId: string }
): void {
  try {
    const nativeSessionId = entry.nativeSessionId.trim();
    if (!nativeSessionId || !entry.missionId.trim() || !entry.objectiveId.trim()) return;
    writeOwnerOnlyFileAtomically(
      nativeSessionIndexPath({ agent: entry.agent, nativeSessionId }),
      JSON.stringify({
        agent: entry.agent.toLowerCase(),
        workingDirectory: path.resolve(entry.workingDirectory),
        missionId: entry.missionId.trim(),
        objectiveId: entry.objectiveId.trim()
      })
    );
  } catch {
    // Best-effort. Without the entry an unlaunched session simply gets no hook attribution.
  }
}

export function readNativeSessionIndex({
  agent,
  nativeSessionId
}: {
  agent: string;
  nativeSessionId: string;
}): NativeSessionIndexEntry | null {
  try {
    const filePath = nativeSessionIndexPath({ agent, nativeSessionId });
    if (!existsSync(filePath)) return null;
    const contents = readBoundedUtf8File(filePath, MAX_INDEX_FILE_BYTES);
    if (!contents) return null;
    const raw = JSON.parse(contents) as Record<string, unknown>;
    const fields = ['agent', 'workingDirectory', 'missionId', 'objectiveId'] as const;
    if (!fields.every(field => typeof raw[field] === 'string' && (raw[field] as string).trim())) {
      return null;
    }
    return raw as NativeSessionIndexEntry;
  } catch {
    return null;
  }
}

/** Removed at delivery, and only when the entry still names the delivered objective. */
export function removeNativeSessionIndex({
  agent,
  nativeSessionId,
  objectiveIds
}: {
  agent: string;
  nativeSessionId: string;
  objectiveIds: string[];
}): void {
  const entry = readNativeSessionIndex({ agent, nativeSessionId });
  if (!entry || !objectiveIds.includes(entry.objectiveId)) return;
  try {
    rmSync(nativeSessionIndexPath({ agent, nativeSessionId }), { force: true });
  } catch {
    // Cleanup only; a stale entry leads to a session key that is already ended.
  }
}

/**
 * The harness's own id for the conversation running this process, when it exports one.
 *
 * Claude Code sets `CLAUDE_CODE_SESSION_ID` in every Bash tool environment and in the
 * environment of its MCP servers, so attach run by the agent can index itself.
 *
 * Codex sets `CODEX_SESSION_ID` (the root session) and `CODEX_THREAD_ID` in every shell tool
 * environment. The root session id is what Codex hooks send as `session_id` and, for a root
 * thread, equals the thread id its status line reads (fixtures/shell-session-env.json), so it is
 * the one indexed. Claude is checked first, so a session that inherited both keeps its existing
 * Claude binding.
 */
export function harnessNativeSession(
  env: NodeJS.ProcessEnv = process.env
): { agent: string; nativeSessionId: string } | null {
  const claude = env.CLAUDE_CODE_SESSION_ID?.trim();
  if (claude) return { agent: 'claude', nativeSessionId: claude };
  const codex = env.CODEX_SESSION_ID?.trim() || env.CODEX_THREAD_ID?.trim();
  if (codex) return { agent: 'codex', nativeSessionId: codex };
  return null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve the hook binding, or `null` for an unbound session.
 *
 * Cost before a match is at most one environment read and one `stat` of the index path, which is
 * the scope gate's allowance for "a lookup in already-known local state".
 */
export function resolveHookBinding({
  agent,
  nativeSessionId,
  workingDirectory,
  missionId: explicitMissionId,
  objectiveId: explicitObjectiveId,
  env = process.env
}: {
  agent: string;
  nativeSessionId: string | null;
  workingDirectory: string;
  missionId?: string | null;
  objectiveId?: string | null;
  env?: NodeJS.ProcessEnv;
}): HookBinding | null {
  const objectiveId = nonEmpty(explicitObjectiveId) ?? nonEmpty(env.OVERLORD_OBJECTIVE_ID);
  const missionId =
    nonEmpty(explicitMissionId) ??
    nonEmpty(env.OVERLORD_MISSION_ID) ??
    nonEmpty(env.MISSION_ID) ??
    missionDisplayIdFromObjectiveRef(objectiveId);
  if (missionId) {
    return {
      missionId,
      objectiveId,
      sessionKey: objectiveId
        ? (readCachedSessionKey({ missionId, workingDirectory, objectiveId }) ?? null)
        : null,
      workingDirectory,
      source: 'env'
    };
  }
  if (!nativeSessionId) return null;
  const entry = readNativeSessionIndex({ agent, nativeSessionId });
  if (!entry) return null;
  return {
    missionId: entry.missionId,
    objectiveId: entry.objectiveId,
    sessionKey:
      readCachedSessionKey({
        missionId: entry.missionId,
        workingDirectory: entry.workingDirectory,
        objectiveId: entry.objectiveId
      }) ?? null,
    workingDirectory: entry.workingDirectory,
    source: 'native-session-index'
  };
}

/**
 * Next follow-up turn index for a native conversation (0 for its first prompt).
 *
 * Claude Code does not put a turn number in its hook payload, so the CLI keeps the last index per
 * native session id. It only deduplicates retries server-side; it never authorizes anything.
 */
export function nextHookTurnIndex({
  agent,
  nativeSessionId
}: {
  agent: string;
  nativeSessionId: string;
}): number {
  const filePath = path.join(
    resolveGlobalDataDir(),
    TURN_DIR,
    digest(`${agent.toLowerCase()}\0${nativeSessionId}`)
  );
  let last = -1;
  try {
    const raw = existsSync(filePath) ? readBoundedUtf8File(filePath, 64) : null;
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed >= 0) last = parsed;
  } catch {
    last = -1;
  }
  const next = last + 1;
  try {
    writeOwnerOnlyFileAtomically(filePath, String(next));
  } catch {
    // A lost counter only weakens retry deduplication.
  }
  return next;
}

function lastPromptPath(agent: string, nativeSessionId: string): string {
  return path.join(
    resolveGlobalDataDir(),
    PROMPT_DIR,
    digest(`${agent.toLowerCase()}\0${nativeSessionId}`)
  );
}

/**
 * Whether `digest` is the prompt last recorded for this native conversation.
 *
 * For a harness whose prompt arrives on every model invocation of a turn (Antigravity
 * `PreInvocation.lastUserInput`), this is what keeps one submission one follow-up. Only a hash is
 * stored, never the prompt.
 */
export function isRepeatedHookPrompt({
  agent,
  nativeSessionId,
  digest: promptDigest
}: {
  agent: string;
  nativeSessionId: string;
  digest: string;
}): boolean {
  try {
    const filePath = lastPromptPath(agent, nativeSessionId);
    if (!existsSync(filePath)) return false;
    return readBoundedUtf8File(filePath, 128)?.trim() === promptDigest;
  } catch {
    return false;
  }
}

export function recordHookPrompt({
  agent,
  nativeSessionId,
  digest: promptDigest
}: {
  agent: string;
  nativeSessionId: string;
  digest: string;
}): void {
  try {
    writeOwnerOnlyFileAtomically(lastPromptPath(agent, nativeSessionId), promptDigest);
  } catch {
    // Without the marker the next invocation records the same prompt again; the backend's
    // idempotency key includes the turn index, so that would be a duplicate follow-up.
  }
}

function stopReminderPath(sessionKey: string, objectiveId: string | null): string {
  return path.join(
    resolveGlobalDataDir(),
    STOP_REMINDER_DIR,
    digest(`${sessionKey}\0${objectiveId ?? ''}`)
  );
}

/** The Stop delivery reminder is shown at most once per protocol session and objective. */
export function hasStopReminder(sessionKey: string, objectiveId: string | null): boolean {
  return existsSync(stopReminderPath(sessionKey, objectiveId));
}

export function markStopReminder(sessionKey: string, objectiveId: string | null): void {
  try {
    writeOwnerOnlyFileAtomically(
      stopReminderPath(sessionKey, objectiveId),
      new Date().toISOString()
    );
  } catch {
    // Without the marker the reminder may repeat once more; Claude's stop_hook_active still
    // prevents a loop within one stop.
  }
}
