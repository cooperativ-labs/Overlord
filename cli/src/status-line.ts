import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';

import { readBoundedPayloadFile } from './agent-session/event.js';
import type { BackendClient } from './backend-client.js';
import { resolveGlobalDataDir } from './config.js';
import { readNativeSessionIndex } from './hook-binding.js';
import { readBoundedUtf8File, writeOwnerOnlyFileAtomically } from './local-file-storage.js';
import { asRecord } from './records.js';

/**
 * `ovld status-line --agent <key> [--payload-file -]` — a terminal status surface for the session
 * binding (`terminal.statusSurface`).
 *
 * A harness runs this on every status refresh. Claude Code pipes its status-line JSON on stdin
 * (`session_id`, `cwd`, …), debounces updates at 300 ms and cancels a run still in flight, so the
 * command must answer from local state at once. Codex reaches it through the Overlord MCP shim's
 * statusline provider, which runs `--agent codex --native-session-id <thread id> --ui-tree` and
 * caches the answer (`connectors/core/scripts/overlord-mcp.mjs`):
 *
 * - **Binding.** The native-session index that `attach` writes for this harness conversation
 *   names the mission and objective; otherwise the launch environment does. Nothing else (in
 *   particular not the working directory) selects a binding. An unbound session prints nothing,
 *   reads no cache, spawns nothing and makes no network call.
 * - **Cache.** Titles and state come from an owner-only snapshot under the global data dir,
 *   keyed by mission and objective. When it is older than `STATUS_LINE_FRESH_MS` the command
 *   still prints what it has and starts one detached `--refresh` process, guarded by a lock
 *   file so concurrent runs do not stampede the backend.
 * - **Fail quiet.** Every path exits 0. On any error the line falls back to the identifiers, or
 *   to nothing; it never writes to stderr, because a status line that speaks shows noise the
 *   user cannot turn off.
 *
 * The refresh is three side-effect-free reads: mission search in display-id mode (title and
 * status type, where `blocked` means an agent asked a question), the mission's objectives (title
 * and state) and the objective's open agent requests (questions or permissions waiting for a
 * human). `GET /api/missions/:id` is deliberately not used: reading it marks the mission's
 * blocking-question indicator seen.
 */

export const STATUS_LINE_FRESH_MS = 20_000;
/** A refresh lock younger than this means a refresh is already running. */
export const STATUS_LINE_REFRESH_LOCK_MS = 15_000;
/** Hard ceiling for a background refresh, so a hung backend never leaves a process behind. */
export const STATUS_LINE_REFRESH_DEADLINE_MS = 8_000;
const MAX_SNAPSHOT_BYTES = 16 * 1024;
const MAX_TITLE_CHARS = 200;
const SNAPSHOT_DIR = 'status-line';

export type StatusLineBinding = {
  missionId: string;
  objectiveId: string | null;
  source: 'native-session-index' | 'env';
};

export type StatusLineSnapshot = {
  schemaVersion: 1;
  missionId: string;
  objectiveId: string | null;
  mission: { displayId: string; title: string; statusType: string | null } | null;
  objective: { displayId: string | null; title: string; state: string | null } | null;
  /** Open agent requests for the objective, by kind; null when the read failed. */
  openRequests: { question: number; permission: number } | null;
  fetchedAt: string;
};

export type StatusLineState = 'awaiting-answer' | 'awaiting-approval' | 'blocked' | 'delivered';

export type StatusLineView = {
  bound: boolean;
  source: StatusLineBinding['source'] | null;
  missionId: string | null;
  objectiveId: string | null;
  missionTitle: string | null;
  objectiveTitle: string | null;
  state: StatusLineState | null;
  stale: boolean;
  fetchedAt: string | null;
};

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boundedTitle(value: unknown): string | null {
  const text = nonEmpty(value)?.replace(/\s+/g, ' ');
  return text ? text.slice(0, MAX_TITLE_CHARS) : null;
}

/**
 * The native session id and working directory a status-line payload carries.
 *
 * Claude Code sends `session_id` and `workspace.current_dir`. Codex sends its statusline state
 * (`com.openai/codex-statusline-state`), whose displayed thread is `thread.id` with
 * `thread.workspace.cwd`; a root thread's id is also its session id.
 */
export function readStatusLinePayload(raw: string | null): {
  nativeSessionId: string | null;
  workingDirectory: string | null;
} {
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? asRecord(JSON.parse(raw)) : {};
  } catch {
    payload = {};
  }
  const thread = asRecord(payload.thread);
  return {
    nativeSessionId:
      nonEmpty(payload.session_id) ?? nonEmpty(payload.sessionId) ?? nonEmpty(thread.id),
    workingDirectory:
      nonEmpty(asRecord(payload.workspace).current_dir) ??
      nonEmpty(payload.cwd) ??
      nonEmpty(asRecord(thread.workspace).cwd) ??
      null
  };
}

/**
 * Which mission and objective this harness session is bound to, or null.
 *
 * The native-session index comes first: it is written by the latest `attach` in this very
 * conversation, so it follows an agent that attached to another objective after launch. The
 * launch environment is the fallback for a launched session whose agent has not attached yet.
 * Cost before a match: one `stat` and environment reads.
 */
export function resolveStatusLineBinding({
  agent,
  nativeSessionId,
  env = process.env
}: {
  agent: string;
  nativeSessionId: string | null;
  env?: NodeJS.ProcessEnv;
}): StatusLineBinding | null {
  if (nativeSessionId) {
    const entry = readNativeSessionIndex({ agent, nativeSessionId });
    if (entry && entry.agent === agent.toLowerCase()) {
      return {
        missionId: entry.missionId,
        objectiveId: entry.objectiveId,
        source: 'native-session-index'
      };
    }
  }
  const objectiveId = nonEmpty(env.OVERLORD_OBJECTIVE_ID);
  const missionId =
    nonEmpty(env.OVERLORD_MISSION_ID) ??
    nonEmpty(env.MISSION_ID) ??
    missionDisplayIdFromObjectiveRef(objectiveId);
  if (!missionId) return null;
  return { missionId, objectiveId, source: 'env' };
}

function snapshotKey(missionId: string, objectiveId: string | null): string {
  return createHash('sha256')
    .update(`${missionId}\0${objectiveId ?? ''}`)
    .digest('hex');
}

export function statusLineSnapshotPath(
  missionId: string,
  objectiveId: string | null,
  dataDir = resolveGlobalDataDir()
): string {
  return path.join(dataDir, SNAPSHOT_DIR, `${snapshotKey(missionId, objectiveId)}.json`);
}

function refreshLockPath(missionId: string, objectiveId: string | null): string {
  return path.join(
    resolveGlobalDataDir(),
    SNAPSHOT_DIR,
    `${snapshotKey(missionId, objectiveId)}.refresh`
  );
}

export function readStatusLineSnapshot(
  missionId: string,
  objectiveId: string | null
): StatusLineSnapshot | null {
  try {
    const filePath = statusLineSnapshotPath(missionId, objectiveId);
    if (!existsSync(filePath)) return null;
    const raw = asRecord(JSON.parse(readBoundedUtf8File(filePath, MAX_SNAPSHOT_BYTES) ?? 'null'));
    if (raw.schemaVersion !== 1 || raw.missionId !== missionId) return null;
    if ((raw.objectiveId ?? null) !== objectiveId) return null;
    if (typeof raw.fetchedAt !== 'string') return null;
    return raw as unknown as StatusLineSnapshot;
  } catch {
    return null;
  }
}

export function writeStatusLineSnapshot(snapshot: StatusLineSnapshot): void {
  try {
    writeOwnerOnlyFileAtomically(
      statusLineSnapshotPath(snapshot.missionId, snapshot.objectiveId),
      JSON.stringify(snapshot)
    );
  } catch {
    // A lost snapshot only delays titles until the next refresh.
  }
}

/**
 * Take the refresh lock, or report that another process holds a live one.
 *
 * The lock is a file whose mtime is the claim time. A lock older than the refresh deadline
 * belongs to a process that died, so it is reclaimed.
 */
export function claimStatusLineRefresh(
  missionId: string,
  objectiveId: string | null,
  now = Date.now()
): boolean {
  const lockPath = refreshLockPath(missionId, objectiveId);
  try {
    if (existsSync(lockPath)) {
      if (now - statSync(lockPath).mtimeMs < STATUS_LINE_REFRESH_LOCK_MS) return false;
      const seconds = now / 1000;
      utimesSync(lockPath, seconds, seconds);
      return true;
    }
    // Two runs racing here may both refresh once; the lock only has to stop a stampede.
    writeOwnerOnlyFileAtomically(lockPath, '');
    return true;
  } catch {
    return false;
  }
}

function resolveState(snapshot: StatusLineSnapshot | null): StatusLineState | null {
  if (!snapshot) return null;
  if (snapshot.openRequests?.question) return 'awaiting-answer';
  if (snapshot.openRequests?.permission) return 'awaiting-approval';
  if (snapshot.mission?.statusType === 'blocked') return 'blocked';
  const objectiveState = snapshot.objective?.state;
  if (objectiveState === 'pending_delivery' || objectiveState === 'complete') return 'delivered';
  return null;
}

export function buildStatusLineView({
  binding,
  snapshot,
  now = Date.now()
}: {
  binding: StatusLineBinding | null;
  snapshot: StatusLineSnapshot | null;
  now?: number;
}): StatusLineView {
  if (!binding) {
    return {
      bound: false,
      source: null,
      missionId: null,
      objectiveId: null,
      missionTitle: null,
      objectiveTitle: null,
      state: null,
      stale: false,
      fetchedAt: null
    };
  }
  const fetchedAt = snapshot ? Date.parse(snapshot.fetchedAt) : Number.NaN;
  const objectiveDisplay =
    snapshot?.objective?.displayId ??
    (binding.objectiveId && missionDisplayIdFromObjectiveRef(binding.objectiveId)
      ? binding.objectiveId
      : null);
  return {
    bound: true,
    source: binding.source,
    missionId: snapshot?.mission?.displayId ?? binding.missionId,
    objectiveId: objectiveDisplay,
    missionTitle: snapshot?.mission?.title ?? null,
    objectiveTitle: snapshot?.objective?.title ?? null,
    state: resolveState(snapshot),
    stale: !Number.isFinite(fetchedAt) || now - fetchedAt >= STATUS_LINE_FRESH_MS,
    fetchedAt: snapshot?.fetchedAt ?? null
  };
}

const STATE_LABEL: Record<StatusLineState, string> = {
  'awaiting-answer': 'awaiting answer',
  'awaiting-approval': 'awaiting approval',
  blocked: 'blocked',
  delivered: 'delivered'
};

const STATE_COLOR: Record<StatusLineState, string> = {
  'awaiting-answer': '33',
  'awaiting-approval': '33',
  blocked: '31',
  delivered: '32'
};

function truncate(text: string, max: number): string {
  if (max <= 1) return '';
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * One line: `ovld coo:12 <mission title> › ab12 <objective title> · <state>`.
 *
 * Titles share whatever width is left after the identifiers and state, objective first, so the
 * line fits `columns`. Identifiers are always shown in full.
 */
export function renderStatusLine({
  view,
  columns,
  color
}: {
  view: StatusLineView;
  columns: number;
  color: boolean;
}): string {
  if (!view.bound || !view.missionId) return '';
  const paint = (code: string, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const objectiveKey = view.objectiveId?.startsWith(`${view.missionId}.`)
    ? view.objectiveId.slice(view.missionId.length + 1)
    : view.objectiveId;
  const stateLabel = view.state ? STATE_LABEL[view.state] : null;

  const fixed =
    'ovld '.length +
    view.missionId.length +
    (objectiveKey ? ' › '.length + objectiveKey.length : 0) +
    (stateLabel ? ' · '.length + stateLabel.length : 0);
  let budget = Math.max(0, columns - fixed - 2);
  let objectiveTitle = '';
  let missionTitle = '';
  if (view.objectiveTitle && budget > 8) {
    const share = view.missionTitle ? Math.max(12, Math.floor(budget * 0.6)) : budget;
    objectiveTitle = truncate(view.objectiveTitle, Math.min(share, budget) - 1);
    budget -= objectiveTitle ? objectiveTitle.length + 1 : 0;
  }
  if (view.missionTitle && budget > 8) {
    missionTitle = truncate(view.missionTitle, budget - 1);
  }

  const parts = [paint('2', 'ovld'), ' ', paint('1', view.missionId)];
  if (missionTitle) parts.push(' ', missionTitle);
  if (objectiveKey) {
    parts.push(paint('2', ' › '), paint('1', objectiveKey));
    if (objectiveTitle) parts.push(' ', objectiveTitle);
  }
  if (view.state && stateLabel) {
    parts.push(paint('2', ' · '), paint(STATE_COLOR[view.state], stateLabel));
  }
  return parts.join('');
}

/**
 * A Codex statusline UI tree node (`statusline.d.ts` in Codex's create-statusline skill): a
 * string, or an element with children. `null` clears the footer.
 */
export type StatusLineUiNode =
  | string
  | null
  | { type: 'row'; props: { gap: number; wrap?: 'wrap' | 'nowrap' }; children: StatusLineUiNode[] }
  | { type: 'text'; props?: { color?: string }; children: StatusLineUiNode[] }
  | { type: 'bold'; children: StatusLineUiNode[] };

/** Codex named colors: the theme's own metadata color, and plain ANSI names for state. */
const STATE_UI_COLOR: Record<StatusLineState, string> = {
  'awaiting-answer': 'yellow',
  'awaiting-approval': 'yellow',
  blocked: 'red',
  delivered: 'green'
};

/** Codex gives a provider no width, so each title gets a fixed share. */
export const STATUS_LINE_UI_MISSION_TITLE_CHARS = 32;
export const STATUS_LINE_UI_OBJECTIVE_TITLE_CHARS = 48;

/**
 * The same segment as {@link renderStatusLine}, as a Codex statusline UI tree: a `row` of
 * `ovld coo:12 <mission title> › ab12 <objective title> · <state>`, or `null` when unbound.
 * Codex renders it in the TUI footer; the MCP shim puts it after the built-in items it keeps.
 */
export function renderStatusLineUiTree(view: StatusLineView): StatusLineUiNode {
  if (!view.bound || !view.missionId) return null;
  const muted = (text: string): StatusLineUiNode => ({
    type: 'text',
    props: { color: 'status-metadata' },
    children: [text]
  });
  const objectiveKey = view.objectiveId?.startsWith(`${view.missionId}.`)
    ? view.objectiveId.slice(view.missionId.length + 1)
    : view.objectiveId;
  const children: StatusLineUiNode[] = [
    muted('ovld'),
    { type: 'bold', children: [view.missionId] }
  ];
  if (view.missionTitle) {
    children.push(truncate(view.missionTitle, STATUS_LINE_UI_MISSION_TITLE_CHARS));
  }
  if (objectiveKey) {
    children.push(muted('›'), { type: 'bold', children: [objectiveKey] });
    if (view.objectiveTitle) {
      children.push(truncate(view.objectiveTitle, STATUS_LINE_UI_OBJECTIVE_TITLE_CHARS));
    }
  }
  if (view.state) {
    children.push(muted('·'), {
      type: 'text',
      props: { color: STATE_UI_COLOR[view.state] },
      children: [STATE_LABEL[view.state]]
    });
  }
  return { type: 'row', props: { gap: 1, wrap: 'nowrap' }, children };
}

export type StatusLineRefreshSpawner = (binding: StatusLineBinding) => void;

/** Start `ovld status-line --refresh` detached, so the harness can cancel this run freely. */
export function spawnDetachedStatusLineRefresh(binding: StatusLineBinding): void {
  const entry = process.argv[1];
  if (!entry) return;
  try {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        entry,
        'status-line',
        '--refresh',
        '--mission-id',
        binding.missionId,
        ...(binding.objectiveId ? ['--objective-id', binding.objectiveId] : [])
      ],
      { detached: true, stdio: 'ignore', env: process.env }
    );
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The line keeps showing the identifiers.
  }
}

/** Compute the status line for a harness payload. Never throws; never touches the network. */
export function runStatusLine({
  agent,
  payloadRaw,
  nativeSessionId: explicitNativeSessionId,
  format = 'text',
  env = process.env,
  columns,
  color,
  now = Date.now(),
  spawnRefresh = spawnDetachedStatusLineRefresh
}: {
  agent: string;
  payloadRaw: string | null;
  nativeSessionId?: string | null;
  format?: 'text' | 'json' | 'ui-tree';
  env?: NodeJS.ProcessEnv;
  columns?: number;
  color?: boolean;
  now?: number;
  spawnRefresh?: StatusLineRefreshSpawner;
}): { stdout: string; view: StatusLineView } {
  try {
    const payload = readStatusLinePayload(payloadRaw);
    const nativeSessionId = nonEmpty(explicitNativeSessionId) ?? payload.nativeSessionId;
    const binding = resolveStatusLineBinding({ agent, nativeSessionId, env });
    const snapshot = binding
      ? readStatusLineSnapshot(binding.missionId, binding.objectiveId)
      : null;
    const view = buildStatusLineView({ binding, snapshot, now });
    if (
      binding &&
      view.stale &&
      claimStatusLineRefresh(binding.missionId, binding.objectiveId, now)
    ) {
      spawnRefresh(binding);
    }
    if (format === 'json') return { stdout: `${JSON.stringify(view)}\n`, view };
    if (format === 'ui-tree') {
      return { stdout: `${JSON.stringify(renderStatusLineUiTree(view))}\n`, view };
    }
    const width = columns ?? (Number.parseInt(env.COLUMNS ?? '', 10) || 120);
    const useColor = color ?? !nonEmpty(env.NO_COLOR);
    const line = renderStatusLine({ view, columns: width, color: useColor });
    return { stdout: line ? `${line}\n` : '', view };
  } catch {
    // A Codex provider must still answer with a tree; `null` clears the Overlord segment.
    return {
      stdout: format === 'ui-tree' ? 'null\n' : '',
      view: buildStatusLineView({ binding: null, snapshot: null })
    };
  }
}

function countOpenRequests(value: unknown): { question: number; permission: number } {
  const requests = Array.isArray(asRecord(value).requests)
    ? (asRecord(value).requests as unknown[])
    : [];
  let question = 0;
  let permission = 0;
  for (const item of requests) {
    const request = asRecord(item);
    if (request.status !== 'open') continue;
    if (request.kind === 'question' || request.kind === 'choice') question += 1;
    else permission += 1;
  }
  return { question, permission };
}

/**
 * Re-read the binding's mission, objective and open requests and store a fresh snapshot.
 *
 * Each read is independent: one that fails keeps the previous snapshot's value for that part,
 * so a flaky backend never blanks titles that were already known.
 */
export async function refreshStatusLineSnapshot({
  backend,
  missionId,
  objectiveId,
  now = () => new Date()
}: {
  backend: Pick<BackendClient, 'get'>;
  missionId: string;
  objectiveId: string | null;
  now?: () => Date;
}): Promise<StatusLineSnapshot> {
  const previous = readStatusLineSnapshot(missionId, objectiveId);
  const missionRef = encodeURIComponent(missionId);
  const requestParams = new URLSearchParams({ missionId, status: 'open', limit: '50' });
  if (objectiveId) requestParams.set('objectiveId', objectiveId);

  const [missionResult, objectivesResult, requestsResult] = await Promise.allSettled([
    backend.get<unknown>(`/api/missions/search?q=${missionRef}&limit=5`),
    objectiveId
      ? backend.get<unknown>(`/api/missions/${missionRef}/objectives`)
      : Promise.resolve(null),
    backend.get<unknown>(`/api/agent-requests?${requestParams.toString()}`)
  ]);

  let mission = previous?.mission ?? null;
  if (missionResult.status === 'fulfilled') {
    const missions = asRecord(missionResult.value).missions;
    const match = (Array.isArray(missions) ? missions : [])
      .map(asRecord)
      .find(candidate => candidate.displayId === missionId || candidate.id === missionId);
    if (match) {
      mission = {
        displayId: nonEmpty(match.displayId) ?? missionId,
        title: boundedTitle(match.title) ?? '',
        statusType: nonEmpty(match.statusType)
      };
    }
  }

  let objective = previous?.objective ?? null;
  if (objectivesResult.status === 'fulfilled' && objectiveId) {
    const list = Array.isArray(objectivesResult.value) ? objectivesResult.value : [];
    const match = list
      .map(asRecord)
      .find(candidate => candidate.id === objectiveId || candidate.displayId === objectiveId);
    if (match) {
      objective = {
        displayId: nonEmpty(match.displayId),
        title: boundedTitle(match.title) ?? '',
        state: nonEmpty(match.state)
      };
    }
  }

  const openRequests =
    requestsResult.status === 'fulfilled'
      ? countOpenRequests(requestsResult.value)
      : (previous?.openRequests ?? null);

  const snapshot: StatusLineSnapshot = {
    schemaVersion: 1,
    missionId,
    objectiveId,
    mission,
    objective,
    openRequests,
    fetchedAt: now().toISOString()
  };
  writeStatusLineSnapshot(snapshot);
  return snapshot;
}

function flagString(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** CLI entry. Prints the line (or nothing) and always exits 0. */
export async function runStatusLineCommand({
  flags
}: {
  flags: Map<string, string | true>;
}): Promise<void> {
  if (flags.has('--refresh')) {
    const missionId = flagString(flags, '--mission-id');
    if (!missionId) return;
    const deadline = setTimeout(() => process.exit(0), STATUS_LINE_REFRESH_DEADLINE_MS);
    deadline.unref();
    try {
      const { createBackendClient } = await import('./backend-client.js');
      await refreshStatusLineSnapshot({
        backend: createBackendClient(),
        missionId,
        objectiveId: flagString(flags, '--objective-id')
      });
    } catch {
      // Fail quiet: the next stale run retries after the lock expires.
    }
    return;
  }

  const agent = flagString(flags, '--agent') ?? 'claude';
  const payloadFile = flagString(flags, '--payload-file');
  let payloadRaw: string | null = null;
  try {
    payloadRaw = payloadFile ? readBoundedPayloadFile(payloadFile) : null;
  } catch {
    payloadRaw = null;
  }
  const { stdout } = runStatusLine({
    agent,
    payloadRaw,
    nativeSessionId: flagString(flags, '--native-session-id'),
    format: flags.has('--ui-tree') ? 'ui-tree' : flags.has('--json') ? 'json' : 'text'
  });
  if (stdout) process.stdout.write(stdout);
}
