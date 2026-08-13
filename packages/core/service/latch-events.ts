/**
 * Collect and parse Latch `events` NDJSON using the public CLI only.
 *
 * `latch events SESSION --json --from N` is a long-lived tail. Callers snapshot
 * by reading until the child goes idle or exits, then stopping it. Overlord
 * never reads Latch session directories.
 */

import { spawn } from 'node:child_process';

import type { HarnessEvent } from './latch-harness/generated.ts';
import { LatchSessionCommandError } from './latch-session.ts';

const HARNESS_EVENT_TYPES = new Set([
  'user_message',
  'assistant_delta',
  'assistant_message',
  'tool_started',
  'tool_finished',
  'awaiting_input',
  'status'
]);

export type LatchPendingInput = {
  requestId: string;
  kind: 'permission' | 'question';
  prompt: string;
  choices: string[];
  at: string;
};

export type LatchHarnessObservation = {
  cursor: number;
  connectorEpoch: number | null;
  lastEventAt: string | null;
  turnCount: number;
  pendingInput: LatchPendingInput | null;
  unattached: boolean;
};

export type CollectLatchEventsResult = {
  events: HarnessEvent[];
  from: number;
  nextCursor: number;
  ended: boolean;
};

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseHarnessEvent(value: unknown): HarnessEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const type = trimmed(row.type);
  const sessionId = trimmed(row.sessionId);
  const at = trimmed(row.at);
  const harnessVersion = trimmed(row.harnessVersion);
  const connectorEpoch =
    typeof row.connectorEpoch === 'number' && Number.isFinite(row.connectorEpoch)
      ? row.connectorEpoch
      : null;
  if (!type || !HARNESS_EVENT_TYPES.has(type) || !sessionId || !at || !harnessVersion) return null;
  if (connectorEpoch === null || connectorEpoch < 1) return null;
  const base = { sessionId, at, harnessVersion, connectorEpoch };
  switch (type) {
    case 'user_message':
    case 'assistant_delta':
    case 'assistant_message': {
      const text = trimmed(row.text);
      if (!text) return null;
      return { ...base, type, text } as HarnessEvent;
    }
    case 'tool_started': {
      const tool = trimmed(row.tool);
      if (!tool) return null;
      return { ...base, type, tool, input: row.input };
    }
    case 'tool_finished': {
      const tool = trimmed(row.tool);
      if (!tool) return null;
      return { ...base, type, tool, output: row.output };
    }
    case 'awaiting_input': {
      const requestId = trimmed(row.requestId);
      const kind = trimmed(row.kind);
      const prompt = typeof row.prompt === 'string' ? row.prompt : null;
      if (!requestId || (kind !== 'permission' && kind !== 'question') || prompt === null) {
        return null;
      }
      const choices = Array.isArray(row.choices)
        ? row.choices.filter((choice): choice is string => typeof choice === 'string')
        : undefined;
      return {
        ...base,
        type,
        requestId,
        kind,
        prompt,
        ...(choices && choices.length > 0 ? { choices } : {})
      };
    }
    case 'status': {
      const status = trimmed(row.status);
      if (!status) return null;
      return { ...base, type, status };
    }
    default:
      return null;
  }
}

export function parseHarnessEventNdjson(raw: string): HarnessEvent[] {
  const events: HarnessEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    try {
      const parsed = parseHarnessEvent(JSON.parse(trimmedLine) as unknown);
      if (parsed) events.push(parsed);
    } catch {
      // Skip a malformed line rather than dropping the rest of a valid stream.
    }
  }
  return events;
}

/**
 * Fold a suffix of the public event stream into presentation state.
 *
 * The agent's protocol attach is the record; this fold is presentation only.
 * `unattached` is true when Latch observed turns and Overlord has no bound
 * agent session yet.
 */
export function foldHarnessEvents({
  events,
  fromCursor,
  attached
}: {
  events: HarnessEvent[];
  fromCursor: number;
  attached: boolean;
}): LatchHarnessObservation {
  let pendingInput: LatchPendingInput | null = null;
  let turnCount = 0;
  let lastEventAt: string | null = null;
  let connectorEpoch: number | null = null;
  for (const event of events) {
    lastEventAt = event.at;
    connectorEpoch = event.connectorEpoch;
    if (event.type === 'user_message' || event.type === 'assistant_message') {
      turnCount += 1;
    }
    if (event.type === 'awaiting_input') {
      pendingInput = {
        requestId: event.requestId,
        kind: event.kind,
        prompt: event.prompt,
        choices: event.choices ?? [],
        at: event.at
      };
      continue;
    }
    pendingInput = null;
  }
  return {
    cursor: fromCursor + events.length,
    connectorEpoch,
    lastEventAt,
    turnCount,
    pendingInput,
    unattached: turnCount > 0 && !attached
  };
}

export function mergeHarnessObservation({
  previous,
  incoming,
  attached
}: {
  previous: LatchHarnessObservation | null;
  incoming: LatchHarnessObservation;
  attached: boolean;
}): LatchHarnessObservation {
  const turnCount = (previous?.turnCount ?? 0) + incoming.turnCount;
  return {
    cursor: incoming.cursor,
    connectorEpoch: incoming.connectorEpoch ?? previous?.connectorEpoch ?? null,
    lastEventAt: incoming.lastEventAt ?? previous?.lastEventAt ?? null,
    turnCount,
    pendingInput: incoming.pendingInput,
    unattached: turnCount > 0 && !attached
  };
}

export async function collectLatchEvents({
  executable = 'latch',
  providerSessionId,
  from = 0,
  idleMs = 250,
  timeoutMs = 8_000
}: {
  executable?: string | null;
  providerSessionId: string;
  from?: number;
  idleMs?: number;
  timeoutMs?: number;
}): Promise<CollectLatchEventsResult> {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const fromCursor = Number.isFinite(from) && from > 0 ? Math.floor(from) : 0;
  const bin = trimmed(executable) ?? 'latch';

  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['events', sessionId, '--json', '--from', String(fromCursor)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = ({ ended, error }: { ended: boolean; error?: Error }) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(timeoutTimer);
      if (!child.killed) child.kill('SIGTERM');
      if (error) {
        reject(error);
        return;
      }
      const events = parseHarnessEventNdjson(stdout);
      resolve({
        events,
        from: fromCursor,
        nextCursor: fromCursor + events.length,
        ended
      });
    };

    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish({ ended: false }), idleMs);
    };

    const timeoutTimer = setTimeout(() => finish({ ended: false }), timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      bumpIdle();
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', error => {
      finish({
        ended: false,
        error: new LatchSessionCommandError(error.message)
      });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code && code !== 0 && parseHarnessEventNdjson(stdout).length === 0) {
        const detail = stderr.trim().slice(0, 500) || `latch events exited ${code}`;
        finish({ ended: true, error: new LatchSessionCommandError(detail) });
        return;
      }
      finish({ ended: signal == null && (code === 0 || code === null) });
    });
  });
}
