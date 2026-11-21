import { codexAppServerInjectPath, type CodexInjectPath } from './codex-app-server/inject.js';
import { resolveAgentSessionScope } from './bind.js';
import { type ChannelClient, createChannelClient } from './client.js';
import { parseNativePayload, readBoundedStdin } from './event.js';

/**
 * `ovld agent-session inbox` — pull one pending injection and emit it in the harness's
 * exact native shape.
 *
 * Honesty rules, enforced here rather than left to adapter discipline:
 *
 *   * **Delivered** means the agent has the message. Claude `asyncRewake` exit 2 wakes the
 *     model with the hook's stderr as a system reminder, so that path may acknowledge.
 *   * **Queued(turn-boundary)** means the harness will see it at the next named boundary.
 *     Cursor `followup_message` can only ever report this — never Delivered — and the UI
 *     must say so.
 *   * **Unsupported** is returned when the adapter has no inject path for this event. It is
 *     a better answer than a hopeful Queued.
 *   * An emitted input is never automatically retried (enforced in the service layer).
 *
 * Exit semantics are harness-specific and deliberate:
 *
 *   * Claude mid-turn (`asyncRewake`): write the body to **stderr**, exit **2**.
 *   * Claude Stop: write `{"decision":"block","reason":…}` to stdout, exit 0.
 *   * Cursor stop: write `{"followup_message":…}` to stdout, exit 0.
 *   * Antigravity Stop: write `{"decision":"continue","reason":…}` to stdout, exit 0.
 *   * Antigravity PreInvocation: write `{"injectSteps":[{"userMessage":…}]}` to stdout, exit 0.
 *   * Empty / unbound / error: exit 0 with no output (fail toward silence).
 */

export type ClaimedInput = {
  id: string;
  kind: string;
  body: string;
  leaseId: string;
  leaseExpiresAt: string | null;
};

export type InboxResult = {
  report: 'Delivered' | 'Queued(turn-boundary)' | 'Queued(next-turn)' | 'Unsupported' | 'Empty';
  exitCode: number;
  /** Bytes for stdout. Claude mid-turn leaves this empty and uses stderrBytes instead. */
  stdout: string;
  stderr: string;
  inputId: string | null;
};

type InjectPath =
  | 'claude-mid-turn'
  | 'claude-turn-boundary'
  | 'codex-turn-boundary'
  | 'cursor-turn-boundary'
  | 'antigravity-turn-boundary'
  | 'antigravity-next-invocation'
  | 'pi-mid-turn'
  // Control plane: emitted by the codex-app-server sidecar over JSON-RPC, never by this command.
  | CodexInjectPath
  | 'unsupported';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hookEventName(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  // `hookEventName` is Antigravity's camelCase spelling (agy 1.5.4).
  const name = record.hook_event_name ?? record.hookEventName ?? record.event ?? record.type;
  return typeof name === 'string' ? name : null;
}

/**
 * Choose the inject path from adapter + native event.
 *
 * The closed mapping is the whole point of keeping adapters thin: a payload cannot invent a
 * path the harness does not have, and Cursor cannot accidentally claim mid-turn delivery.
 */
export function resolveInjectPath({
  agent,
  payload
}: {
  agent: string;
  payload: unknown;
}): InjectPath {
  const event = hookEventName(payload)?.toLowerCase() ?? null;
  if (agent === 'claude') {
    if (event === 'stop' || event === 'subagentstop') return 'claude-turn-boundary';
    // SessionStart / PostToolUse / Notification / unknown → mid-turn asyncRewake path.
    return 'claude-mid-turn';
  }
  if (agent === 'cursor') {
    if (event === 'stop' || event === null) return 'cursor-turn-boundary';
    return 'unsupported';
  }
  if (agent === 'codex') {
    if (event === 'stop') return 'codex-turn-boundary';
    return 'unsupported';
  }
  if (agent === 'antigravity') {
    // Before agy 1.5.4 the payload names no event; only the Stop hook runs inbox then.
    if (event === 'stop' || event === null) return 'antigravity-turn-boundary';
    if (event === 'preinvocation') return 'antigravity-next-invocation';
    return 'unsupported';
  }
  if (agent === 'pi') return 'pi-mid-turn';
  // The payload is the sidecar's thread state (`{ activeTurnId }`), not a hook payload.
  if (agent === 'codex-app-server') return codexAppServerInjectPath(payload);
  return 'unsupported';
}

/** Exact native bytes for Claude Stop `decision: "block"`. */
export function encodeClaudeStopBlock(body: string): string {
  return `${JSON.stringify({ decision: 'block', reason: body })}\n`;
}

/** Exact native bytes for Cursor `followup_message`. */
export function encodeCursorFollowup(body: string): string {
  return `${JSON.stringify({ followup_message: body })}\n`;
}

/** Exact native bytes for Codex Stop. `decision:block` creates a continuation prompt. */
export function encodeCodexStopBlock(body: string): string {
  return `${JSON.stringify({ decision: 'block', reason: body })}\n`;
}

/**
 * Exact native bytes for Antigravity Stop. `decision: "continue"` keeps the agent from stopping,
 * re-enters the loop and injects `reason` as a system message; any other decision allows the stop.
 */
export function encodeAntigravityStopContinue(body: string): string {
  return `${JSON.stringify({ decision: 'continue', reason: body })}\n`;
}

/** Exact native bytes for Antigravity PreInvocation: one user message before the model call. */
export function encodeAntigravityInjectUserMessage(body: string): string {
  return `${JSON.stringify({ injectSteps: [{ userMessage: body }] })}\n`;
}

const emptyResult = (report: InboxResult['report'] = 'Empty'): InboxResult => ({
  report,
  exitCode: 0,
  stdout: '',
  stderr: '',
  inputId: null
});

/** Claim cadence while a bounded inbox wait is open. */
export const INBOX_POLL_INTERVAL_MS = 2_000;
/** Ceiling for every inbox wait, explicit or default. */
export const MAX_INBOX_WAIT_MS = 120_000;
/**
 * Default wait at a final Claude `Stop` in a headless session (`claude -p`, Agent SDK).
 *
 * A headless run exits when its last turn ends, so an instruction sent a moment later has no
 * session left to reach. Holding the final Stop open for a bounded window lets it arrive. Since
 * Claude Code 2.1.323 a headless session emits a progress heartbeat every 30 s while a hook runs
 * (fixtures/probe-stop-heartbeat.json), so a hold longer than 30 s no longer looks like a hung
 * turn to the host. Interactive sessions never wait: the user is at the terminal, and a held
 * Stop would only delay their next prompt.
 */
export const CLAUDE_HEADLESS_STOP_WAIT_MS = 60_000;

/**
 * Whether this harness session runs without a user at the terminal.
 *
 * Claude Code sets `CLAUDE_CODE_ENTRYPOINT` for its own child processes (MCP servers included,
 * even when the parent environment carried another value): `cli` interactively, `sdk-cli` for
 * `claude -p`, `sdk-ts`/`sdk-py` for the Agent SDK.
 */
export function isHeadlessHarnessSession({
  agent,
  env = process.env
}: {
  agent: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (agent !== 'claude') return false;
  return /^sdk-/.test(env.CLAUDE_CODE_ENTRYPOINT?.trim() ?? '');
}

/**
 * Whether a Claude Stop payload reports subagents still running in the background.
 *
 * Claude Code fires the main `Stop` while background subagents are still working, then wakes the
 * main agent with a task notification when they finish, which ends in another `Stop`
 * (fixtures/subagent-stop-background.json). That later Stop is the real end of the work.
 * `background_tasks` is an array in the native payload and a JSON string when templated into an
 * `mcp_tool` hook input; both are accepted.
 */
export function hasRunningBackgroundTasks(payload: unknown): boolean {
  let tasks = asRecord(payload)?.background_tasks;
  if (typeof tasks === 'string') {
    try {
      tasks = JSON.parse(tasks) as unknown;
    } catch {
      return false;
    }
  }
  if (!Array.isArray(tasks)) return false;
  return tasks.some(task => asRecord(task)?.status === 'running');
}

function clampWaitMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_INBOX_WAIT_MS);
}

/**
 * How long `inbox` keeps polling for an instruction before answering empty.
 *
 * An explicit `--wait-ms` wins (bounded). Otherwise only a final Claude `Stop` (no background
 * subagent still running) in a headless session waits; every other event and every interactive
 * session claims once and answers at once. The CLI fallback and the `mcp_tool` Stop hook both
 * reach this one rule because the hook spawns this same command.
 */
export function resolveInboxWaitMs({
  agent,
  payload,
  env = process.env,
  requestedMs
}: {
  agent: string;
  payload: unknown;
  env?: NodeJS.ProcessEnv;
  requestedMs?: number | null;
}): number {
  if (requestedMs !== undefined && requestedMs !== null) return clampWaitMs(requestedMs);
  if (agent !== 'claude' || hookEventName(payload) !== 'Stop') return 0;
  if (!isHeadlessHarnessSession({ agent, env })) return 0;
  if (hasRunningBackgroundTasks(payload)) return 0;
  return CLAUDE_HEADLESS_STOP_WAIT_MS;
}

/**
 * Claim one input and produce the harness-native emission.
 *
 * Pure enough to unit-test with a fake client: the native codecs and honesty mapping live
 * here; transport is the only impure seam.
 *
 * With a wait, the first claim is immediate and later claims repeat every
 * `INBOX_POLL_INTERVAL_MS` until one returns an input or the wait ends, so a pending instruction
 * is never delayed by the wait itself. A failed claim (auth, network) ends the wait at once:
 * retrying a broken channel would only hold the harness longer.
 */
export async function runAgentSessionInbox({
  agent,
  payloadRaw,
  env = process.env,
  client: injectedClient,
  waitMs,
  pollIntervalMs = INBOX_POLL_INTERVAL_MS,
  now = Date.now,
  sleepFor = sleep
}: {
  agent: string;
  payloadRaw?: string | null;
  env?: NodeJS.ProcessEnv;
  client?: ChannelClient;
  /** Bounded wait for an instruction. Omitted: `resolveInboxWaitMs` decides. */
  waitMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleepFor?: (ms: number) => Promise<void>;
}): Promise<InboxResult> {
  const scope = resolveAgentSessionScope({ agent, env });
  if (!scope) return emptyResult('Empty');

  const payload =
    payloadRaw === undefined
      ? parseNativePayload(readBoundedStdin())
      : parseNativePayload(payloadRaw);
  const path = resolveInjectPath({ agent, payload });
  if (path === 'unsupported') return emptyResult('Unsupported');
  // A control-plane sidecar claims and emits its own inputs; claiming here would strand one.
  if (path === 'codex-app-server-steer' || path === 'codex-app-server-turn-start') {
    return emptyResult('Unsupported');
  }

  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl && !injectedClient) return emptyResult('Empty');

  const client =
    injectedClient ??
    createChannelClient({ baseUrl: baseUrl!, channelId: scope.channelId, token: scope.token });

  const wait = resolveInboxWaitMs({ agent, payload, env, requestedMs: waitMs });
  const deadline = now() + wait;
  for (;;) {
    const claimed = await client.post<{ input: ClaimedInput | null }>(
      '/inputs/claim',
      {},
      {
        timeoutMs: 5000
      }
    );
    if (!claimed.ok) return emptyResult('Empty');
    if (claimed.value.input) {
      return await emitClaimedInput({ agent, path, input: claimed.value.input, client });
    }
    const remaining = deadline - now();
    if (remaining <= 0) return emptyResult('Empty');
    await sleepFor(Math.min(Math.max(1, pollIntervalMs), remaining));
  }
}

export async function emitClaimedInput({
  agent,
  path,
  input,
  client
}: {
  agent: string;
  path: InjectPath;
  input: ClaimedInput;
  client: ChannelClient;
}): Promise<InboxResult> {
  if (path === 'claude-mid-turn') {
    // asyncRewake: exit 2 feeds stderr (or stdout if stderr empty) to the model as a
    // system reminder and wakes an idle session. That is Delivered — the agent has the text.
    const emitted = await client.post<{ emitted: boolean }>(`/inputs/${input.id}/emitted`, {
      leaseId: input.leaseId,
      deliveryOutcome: 'delivered'
    });
    if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
    await client.post(`/inputs/${input.id}/acknowledged`, {});
    return {
      report: 'Delivered',
      exitCode: 2,
      stdout: '',
      stderr: `[Overlord] ${input.body}`,
      inputId: input.id
    };
  }

  if (path === 'claude-turn-boundary') {
    // Stop decision:block continues the turn with `reason` as the next instruction. The model
    // receives it, so this is also Delivered — at the turn boundary rather than mid-turn.
    const emitted = await client.post<{ emitted: boolean }>(`/inputs/${input.id}/emitted`, {
      leaseId: input.leaseId,
      deliveryOutcome: 'delivered'
    });
    if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
    await client.post(`/inputs/${input.id}/acknowledged`, {});
    return {
      report: 'Delivered',
      exitCode: 0,
      stdout: encodeClaudeStopBlock(input.body),
      stderr: '',
      inputId: input.id
    };
  }

  if (path === 'cursor-turn-boundary') {
    // followup_message schedules the next turn. It must never be reported as Delivered.
    const emitted = await client.post<{ emitted: boolean }>(`/inputs/${input.id}/emitted`, {
      leaseId: input.leaseId,
      deliveryOutcome: 'queued_turn_boundary'
    });
    if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
    return {
      report: 'Queued(turn-boundary)',
      exitCode: 0,
      stdout: encodeCursorFollowup(input.body),
      stderr: '',
      inputId: input.id
    };
  }

  if (path === 'codex-turn-boundary') {
    // Codex documents Stop `decision:block` as creating a new continuation prompt whose
    // content is the supplied reason. The message is therefore received, not merely queued.
    const emitted = await client.post<{ emitted: boolean }>(`/inputs/${input.id}/emitted`, {
      leaseId: input.leaseId,
      deliveryOutcome: 'delivered'
    });
    if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
    await client.post(`/inputs/${input.id}/acknowledged`, {});
    return {
      report: 'Delivered',
      exitCode: 0,
      stdout: encodeCodexStopBlock(input.body),
      stderr: '',
      inputId: input.id
    };
  }

  if (path === 'antigravity-turn-boundary' || path === 'antigravity-next-invocation') {
    // Stop `continue` re-enters the loop with the reason as a system message, and a PreInvocation
    // `userMessage` step is in the trajectory before the model call that follows. Either way the
    // model receives the text in this run, so both are Delivered (as Codex Stop is).
    const emitted = await client.post<{ emitted: boolean }>(`/inputs/${input.id}/emitted`, {
      leaseId: input.leaseId,
      deliveryOutcome: 'delivered'
    });
    if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
    await client.post(`/inputs/${input.id}/acknowledged`, {});
    return {
      report: 'Delivered',
      exitCode: 0,
      stdout:
        path === 'antigravity-turn-boundary'
          ? encodeAntigravityStopContinue(input.body)
          : encodeAntigravityInjectUserMessage(input.body),
      stderr: '',
      inputId: input.id
    };
  }

  if (path === 'pi-mid-turn') {
    // Extension-owned delivery: print the claim and leave it leased. The extension calls
    // sendUserMessage, then confirms with --confirm so we never mark Delivered for a message
    // the agent has not received.
    return {
      report: 'Empty',
      exitCode: 0,
      stdout: `${JSON.stringify({
        inputId: input.id,
        leaseId: input.leaseId,
        body: input.body,
        deliverAs: 'steer'
      })}\n`,
      stderr: '',
      inputId: input.id
    };
  }

  void agent;
  await client.post(`/inputs/${input.id}/failed`, { errorCode: 'inject_unsupported' });
  return emptyResult('Unsupported');
}

/** Confirm a Pi (or similar extension) delivery after sendUserMessage succeeded. */
export async function confirmInboxEmission({
  agent,
  inputId,
  leaseId,
  env = process.env,
  client: injectedClient
}: {
  agent: string;
  inputId: string;
  leaseId: string;
  env?: NodeJS.ProcessEnv;
  client?: ChannelClient;
}): Promise<InboxResult> {
  const scope = resolveAgentSessionScope({ agent, env });
  if (!scope) return emptyResult('Empty');
  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl && !injectedClient) return emptyResult('Empty');
  const client =
    injectedClient ??
    createChannelClient({ baseUrl: baseUrl!, channelId: scope.channelId, token: scope.token });
  const emitted = await client.post<{ emitted: boolean }>(`/inputs/${inputId}/emitted`, {
    leaseId,
    deliveryOutcome: 'delivered'
  });
  if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
  await client.post(`/inputs/${inputId}/acknowledged`, {});
  return {
    report: 'Delivered',
    exitCode: 0,
    stdout: '',
    stderr: '',
    inputId
  };
}

/**
 * OpenCode / control-plane inject: POST prompt_async, then mark Delivered.
 *
 * Lives beside the sidecar rather than in the callback inbox path because Shape C has no
 * hook to invoke `ovld agent-session inbox`. The sidecar is the injector.
 */
export async function injectViaPromptAsync({
  client,
  controlFetch,
  controlBaseUrl,
  password,
  sessionId,
  input
}: {
  client: ChannelClient;
  controlFetch: typeof fetch;
  controlBaseUrl: string;
  password: string;
  sessionId: string;
  input: ClaimedInput;
}): Promise<InboxResult> {
  let response: Response;
  try {
    response = await controlFetch(`${controlBaseUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${password}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ parts: [{ type: 'text', text: input.body }] })
    });
  } catch {
    await client.post(`/inputs/${input.id}/failed`, { errorCode: 'prompt_async_network' });
    return emptyResult('Unsupported');
  }
  if (!response.ok) {
    await client.post(`/inputs/${input.id}/failed`, { errorCode: 'prompt_async_rejected' });
    return emptyResult('Unsupported');
  }
  const emitted = await client.post<{ emitted: boolean }>(`/inputs/${input.id}/emitted`, {
    leaseId: input.leaseId,
    deliveryOutcome: 'delivered'
  });
  if (!emitted.ok || !emitted.value.emitted) return emptyResult('Empty');
  await client.post(`/inputs/${input.id}/acknowledged`, {});
  return {
    report: 'Delivered',
    exitCode: 0,
    stdout: '',
    stderr: '',
    inputId: input.id
  };
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
