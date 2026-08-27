import { execFile } from 'node:child_process';

import { latchBinaryMissingMessage, resolveLatchBinaryPath } from './latch-binary.ts';
import { latchChildEnvironment } from './latch-environment.ts';
import type { LatchGatewayConfig } from './latch-gateway.ts';
import {
  latchConversationSocketUrl,
  latchConversationSubprotocol,
  requireLatchConversationGateway
} from './latch-gateway.ts';
import { buildLatchOpenArgs, latchViewerFlagForKind } from './latch-launch.ts';
import { isLatchSessionAbsentMessage } from './latch-session-absent.ts';
import type { ViewerOpenAs } from './terminal-profile-types.ts';
import { parseViewerOpenAs } from './terminal-profile-types.ts';

export type LatchSessionState = 'running' | 'exited' | 'stopping' | 'lost';

export type LatchSessionInspection = {
  providerSessionId: string;
  name: string;
  state: LatchSessionState;
  exitCode: number | null;
  inspectedAt: string;
};

export type LatchSessionOpenResult = {
  providerSessionId: string;
  viewer: string;
  opened: boolean;
  /**
   * The shape Latch reports it actually used. Null when this Latch build
   * predates `--as` and therefore reports nothing — which always means a window.
   */
  behavior: ViewerOpenAs | null;
};

export type LatchSessionStopResult = {
  providerSessionId: string;
  state: LatchSessionState;
};

export class LatchSessionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatchSessionCommandError';
  }
}

/**
 * Latch has no metadata for this session (prune/remove). Distinct from a
 * generic command failure so the mission panel can hide the card instead of
 * showing Latch's raw "no session" error as a reachability problem.
 */
export class LatchSessionAbsentError extends LatchSessionCommandError {
  constructor(message: string) {
    super(message);
    this.name = 'LatchSessionAbsentError';
  }
}

export { isLatchSessionAbsentMessage } from './latch-session-absent.ts';

export function latchSessionCommandError(detail: string): LatchSessionCommandError {
  const message = detail || 'Latch command failed.';
  return isLatchSessionAbsentMessage(message)
    ? new LatchSessionAbsentError(message)
    : new LatchSessionCommandError(message);
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseState(value: unknown): LatchSessionState | null {
  switch (trimmed(value)) {
    case 'running':
      return 'running';
    case 'exited':
      return 'exited';
    case 'stopping':
      return 'stopping';
    case 'lost':
      return 'lost';
    default:
      return null;
  }
}

async function runLatchJson({
  executable,
  args
}: {
  executable: string;
  args: string[];
}): Promise<Record<string, unknown>> {
  const binary = resolveLatchBinaryPath(executable);
  if (!binary) throw new LatchSessionCommandError(latchBinaryMissingMessage(executable));
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        env: latchChildEnvironment()
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).trim().slice(0, 500);
          reject(latchSessionCommandError(detail));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new LatchSessionCommandError('Latch returned an invalid JSON response.');
  }
}

export async function inspectLatchSession({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): Promise<LatchSessionInspection> {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const report = await runLatchJson({
    executable: trimmed(executable) ?? 'latch',
    args: ['inspect', sessionId, '--json']
  });
  const state = parseState(report.state);
  if (!state) throw new LatchSessionCommandError('Latch returned an unsupported session state.');
  const exit =
    report.exit && typeof report.exit === 'object' && !Array.isArray(report.exit)
      ? (report.exit as Record<string, unknown>)
      : null;
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    name: trimmed(report.name) ?? sessionId,
    state,
    exitCode: typeof exit?.code === 'number' && Number.isFinite(exit.code) ? exit.code : null,
    inspectedAt: new Date().toISOString()
  };
}

/**
 * Read the Latch product version so `--as` is only sent to a build that has it.
 * Best-effort: any failure answers null, which omits the flag and opens a
 * window rather than failing an open for a session that is already running.
 */
async function readLatchProductVersion(executable: string): Promise<string | null> {
  try {
    return trimmed(
      (await runLatchJson({ executable, args: ['capabilities', '--json'] })).productVersion
    );
  } catch {
    return null;
  }
}

export async function openLatchSession({
  executable = 'latch',
  providerSessionId,
  viewerKind,
  openAs
}: {
  executable?: string | null;
  providerSessionId: string;
  viewerKind: string;
  /**
   * Overlord's own window-or-tab preference. Sent explicitly whenever the CLI
   * supports it so Latch's stored `open.behavior` default can never silently
   * disagree with the setting the user sees in Overlord.
   */
  openAs?: ViewerOpenAs | string | null;
}): Promise<LatchSessionOpenResult> {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const viewer = latchViewerFlagForKind(viewerKind);
  if (!viewer) {
    throw new LatchSessionCommandError(`Latch cannot open the configured viewer "${viewerKind}".`);
  }
  const exe = trimmed(executable) ?? 'latch';
  const report = await runLatchJson({
    executable: exe,
    args: buildLatchOpenArgs({
      providerSessionId: sessionId,
      viewer,
      openAs,
      productVersion: openAs ? await readLatchProductVersion(exe) : null
    })
  });
  if (report.opened !== true) {
    throw new LatchSessionCommandError(`Latch did not open the ${viewer} viewer.`);
  }
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    viewer: trimmed(report.viewer) ?? viewer,
    opened: true,
    behavior: trimmed(report.behavior) ? parseViewerOpenAs(report.behavior) : null
  };
}

export async function stopLatchSession({
  executable = 'latch',
  providerSessionId
}: {
  executable?: string | null;
  providerSessionId: string;
}): Promise<LatchSessionStopResult> {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const report = await runLatchJson({
    executable: trimmed(executable) ?? 'latch',
    args: ['stop', sessionId, '--json']
  });
  const state = parseState(report.state);
  if (!state) throw new LatchSessionCommandError('Latch returned an unsupported session state.');
  return {
    providerSessionId: trimmed(report.id) ?? sessionId,
    state
  };
}

// ---------------------------------------------------------------------------
// Conversation Hub: delivering an answer into a running session (coo:833)
// ---------------------------------------------------------------------------

/** Default wait for a busy session to become able to accept a message. */
export const DEFAULT_LATCH_SEND_WAIT_MS = 30_000;

/** How long the gateway has to speak first with its snapshot. */
export const LATCH_CONVERSATION_SNAPSHOT_TIMEOUT_MS = 10_000;

/**
 * How long `operation_result` may take after a `send_message` goes out. Past
 * it the send is `ambiguous`, never retried: it may well have landed.
 */
export const LATCH_OPERATION_RESULT_TIMEOUT_MS = 30_000;

/** Protocol bound on `send_message.text`. */
export const LATCH_MESSAGE_MAX_LENGTH = 16_384;

export type LatchConversationPhase =
  | 'starting'
  | 'idle'
  | 'working'
  | 'awaiting_input'
  | 'exited'
  | 'unavailable';

export type LatchSendMessageStatus = 'accepted' | 'refused' | 'ambiguous';

export type LatchSendMessageOutcome = {
  providerSessionId: string;
  operationId: string;
  status: LatchSendMessageStatus;
  reason: string | null;
  deliveredAt: string;
};

/**
 * The slice of the platform `WebSocket` this client uses. Structural so a test
 * can drive it without a socket, and so the real global satisfies it as-is.
 */
export type LatchConversationSocket = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', handler: () => void): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', handler: () => void): void;
  addEventListener(type: 'error', handler: () => void): void;
};

export type LatchConversationConnect = (args: {
  url: string;
  subprotocol: string;
}) => LatchConversationSocket;

function defaultLatchConversationConnect({
  url,
  subprotocol
}: {
  url: string;
  subprotocol: string;
}): LatchConversationSocket {
  return new WebSocket(url, [subprotocol]) as unknown as LatchConversationSocket;
}

type ConversationAvailability = { enabled: boolean; reason: string | null };

type ConversationState = {
  phase: LatchConversationPhase | null;
  sendMessage: ConversationAvailability;
};

const CONVERSATION_PHASES: readonly LatchConversationPhase[] = [
  'starting',
  'idle',
  'working',
  'awaiting_input',
  'exited',
  'unavailable'
];

function parseConversationState(value: unknown): ConversationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cast = value as Record<string, unknown>;
  const phaseText = trimmed(cast.phase);
  const phase = CONVERSATION_PHASES.find(candidate => candidate === phaseText) ?? null;
  const availability =
    cast.sendMessage && typeof cast.sendMessage === 'object' && !Array.isArray(cast.sendMessage)
      ? (cast.sendMessage as Record<string, unknown>)
      : null;
  if (!availability) return null;
  return {
    phase,
    sendMessage: {
      enabled: availability.enabled === true,
      reason: trimmed(availability.reason)
    }
  };
}

/** Phases where a not-yet-enabled send is worth waiting out. */
function isTransientPhase(phase: LatchConversationPhase | null): boolean {
  return phase === 'starting' || phase === 'working';
}

function refusalReason(state: ConversationState): string {
  if (state.sendMessage.reason) return state.sendMessage.reason;
  if (state.phase === 'exited') return 'The Latch session has exited.';
  if (state.phase === 'unavailable') return 'The Latch session is unavailable.';
  return 'Latch is not accepting messages for this session.';
}

/**
 * Deliver `text` into a running Latch session as a user turn, over the v2
 * Conversation Hub (`WS /v2/sessions/{id}/conversation`).
 *
 * The Hub is the sole owner of conversation ordering and action durability, so
 * this client does exactly one operation and reports what the Hub said about
 * it: `accepted` (delivered), `refused` (not delivered — the caller may show
 * the reason), or `ambiguous` (it may or may not have landed). An `ambiguous`
 * outcome is **never** retried; `operationId` is the caller's idempotency key
 * both here and in the queue that carried the job, so a retry of the whole job
 * cannot double-deliver either.
 */
export async function sendLatchMessage({
  providerSessionId,
  operationId,
  text,
  waitForIdleMs = DEFAULT_LATCH_SEND_WAIT_MS,
  gateway = null,
  env,
  fetchImpl,
  connect = defaultLatchConversationConnect,
  now = () => new Date()
}: {
  providerSessionId: string;
  operationId: string;
  text: string;
  waitForIdleMs?: number | null;
  gateway?: LatchGatewayConfig | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  connect?: LatchConversationConnect;
  now?: () => Date;
}): Promise<LatchSendMessageOutcome> {
  const sessionId = trimmed(providerSessionId);
  if (!sessionId) throw new LatchSessionCommandError('A Latch session id is required.');
  const opId = trimmed(operationId);
  if (!opId) throw new LatchSessionCommandError('An operation id is required.');
  const body = typeof text === 'string' ? text : '';
  if (!body.trim()) throw new LatchSessionCommandError('An answer message is required.');
  if (body.length > LATCH_MESSAGE_MAX_LENGTH) {
    throw new LatchSessionCommandError(
      `An answer may be at most ${LATCH_MESSAGE_MAX_LENGTH} characters.`
    );
  }
  const idleBudgetMs =
    typeof waitForIdleMs === 'number' && Number.isFinite(waitForIdleMs) && waitForIdleMs >= 0
      ? Math.trunc(waitForIdleMs)
      : DEFAULT_LATCH_SEND_WAIT_MS;

  let resolved: { gateway: LatchGatewayConfig };
  try {
    resolved = await requireLatchConversationGateway({ gateway, env, fetchImpl });
  } catch (error) {
    throw new LatchSessionCommandError(
      error instanceof Error ? error.message : 'Latch is not reachable.'
    );
  }

  const status = await runConversationOperation({
    socket: connect({
      url: latchConversationSocketUrl({ gateway: resolved.gateway, providerSessionId: sessionId }),
      subprotocol: latchConversationSubprotocol(resolved.gateway)
    }),
    operationId: opId,
    text: body,
    idleBudgetMs
  });

  return {
    providerSessionId: sessionId,
    operationId: opId,
    status: status.status,
    reason: status.reason,
    deliveredAt: now().toISOString()
  };
}

/**
 * Drive one `send_message` to completion on an open conversation socket.
 *
 * The server speaks first, so nothing is sent on `open`: the snapshot carries
 * the `operationEpoch` the operation must quote and the state that says whether
 * a send is possible at all.
 */
function runConversationOperation({
  socket,
  operationId,
  text,
  idleBudgetMs
}: {
  socket: LatchConversationSocket;
  operationId: string;
  text: string;
  idleBudgetMs: number;
}): Promise<{ status: LatchSendMessageStatus; reason: string | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sent = false;
    let epoch: string | null = null;
    const timers: NodeJS.Timeout[] = [];
    let idleTimer: NodeJS.Timeout | null = null;
    let lastState: ConversationState | null = null;

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      idleTimer = null;
    };
    const arm = (handler: () => void, delayMs: number): NodeJS.Timeout => {
      const timer = setTimeout(handler, delayMs);
      if (typeof timer.unref === 'function') timer.unref();
      timers.push(timer);
      return timer;
    };
    const finish = (outcome: { status: LatchSendMessageStatus; reason: string | null }) => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        socket.close();
      } catch {
        // The outcome is already known; a close failure cannot change it.
      }
      resolve(outcome);
    };
    const abort = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        socket.close();
      } catch {
        // Nothing to salvage; the rejection below is the reported failure.
      }
      reject(new LatchSessionCommandError(message));
    };

    const deliver = () => {
      if (sent || settled) return;
      if (!epoch) {
        abort('Latch did not send an operation epoch for this conversation.');
        return;
      }
      sent = true;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      try {
        socket.send(
          JSON.stringify({ type: 'send_message', operationEpoch: epoch, operationId, text })
        );
      } catch {
        abort('The answer could not be written to the Latch conversation socket.');
        return;
      }
      // Past this point the send may have landed, so every remaining failure
      // path is `ambiguous` rather than a refusal or an error.
      arm(
        () =>
          finish({ status: 'ambiguous', reason: 'Latch did not confirm the delivery in time.' }),
        LATCH_OPERATION_RESULT_TIMEOUT_MS
      );
    };

    const applyState = (state: ConversationState) => {
      lastState = state;
      if (sent || settled) return;
      if (state.sendMessage.enabled) {
        deliver();
        return;
      }
      if (isTransientPhase(state.phase)) {
        if (idleTimer) return;
        idleTimer = arm(() => {
          finish({ status: 'refused', reason: refusalReason(lastState ?? state) });
        }, idleBudgetMs);
        return;
      }
      finish({ status: 'refused', reason: refusalReason(state) });
    };

    const snapshotTimer = arm(() => {
      abort('Latch did not open the conversation for this session.');
    }, LATCH_CONVERSATION_SNAPSHOT_TIMEOUT_MS);

    socket.addEventListener('message', (event: { data: unknown }) => {
      if (settled) return;
      const raw = typeof event.data === 'string' ? event.data : String(event.data ?? '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const message = parsed as Record<string, unknown>;
      switch (message.type) {
        case 'snapshot': {
          clearTimeout(snapshotTimer);
          epoch = trimmed(message.operationEpoch);
          const state = parseConversationState(message.state);
          if (!state) {
            abort('Latch returned an unsupported conversation state.');
            return;
          }
          applyState(state);
          return;
        }
        case 'state_changed': {
          const state = parseConversationState(message.state);
          if (state) applyState(state);
          return;
        }
        case 'operation_result': {
          if (trimmed(message.operationId) !== operationId) return;
          const status = trimmed(message.status);
          if (status !== 'accepted' && status !== 'refused' && status !== 'ambiguous') {
            finish({ status: 'ambiguous', reason: 'Latch reported an unknown operation status.' });
            return;
          }
          finish({ status, reason: trimmed(message.reason) });
          return;
        }
        case 'error': {
          const detail =
            trimmed(message.message) ?? trimmed(message.code) ?? 'Latch reported an error.';
          if (sent) {
            finish({ status: 'ambiguous', reason: detail });
            return;
          }
          abort(detail);
          return;
        }
        default:
          return;
      }
    });

    const disconnected = () => {
      if (settled) return;
      if (sent) {
        finish({ status: 'ambiguous', reason: 'The Latch conversation closed before confirming.' });
        return;
      }
      abort('The Latch conversation closed before the answer could be delivered.');
    };
    socket.addEventListener('close', disconnected);
    socket.addEventListener('error', disconnected);
  });
}
