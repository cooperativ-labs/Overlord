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
  | 'pi-mid-turn'
  | 'unsupported';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hookEventName(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  const name = record.hook_event_name ?? record.event ?? record.type;
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
  if (agent === 'pi') return 'pi-mid-turn';
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

const emptyResult = (report: InboxResult['report'] = 'Empty'): InboxResult => ({
  report,
  exitCode: 0,
  stdout: '',
  stderr: '',
  inputId: null
});

/**
 * Claim one input and produce the harness-native emission.
 *
 * Pure enough to unit-test with a fake client: the native codecs and honesty mapping live
 * here; transport is the only impure seam.
 */
export async function runAgentSessionInbox({
  agent,
  payloadRaw,
  env = process.env,
  client: injectedClient,
  waitMs = 0
}: {
  agent: string;
  payloadRaw?: string | null;
  env?: NodeJS.ProcessEnv;
  client?: ChannelClient;
  /** Optional bounded wait before claiming (SessionStart long-poll). */
  waitMs?: number;
}): Promise<InboxResult> {
  const scope = resolveAgentSessionScope({ agent, env });
  if (!scope) return emptyResult('Empty');

  const payload =
    payloadRaw === undefined
      ? parseNativePayload(readBoundedStdin())
      : parseNativePayload(payloadRaw);
  const path = resolveInjectPath({ agent, payload });
  if (path === 'unsupported') return emptyResult('Unsupported');

  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl && !injectedClient) return emptyResult('Empty');

  const client =
    injectedClient ??
    createChannelClient({ baseUrl: baseUrl!, channelId: scope.channelId, token: scope.token });

  if (waitMs > 0) await sleep(waitMs);

  const claimed = await client.post<{ input: ClaimedInput | null }>(
    '/inputs/claim',
    {},
    {
      timeoutMs: 5000
    }
  );
  if (!claimed.ok || !claimed.value.input) return emptyResult('Empty');

  const input = claimed.value.input;
  return await emitClaimedInput({ agent, path, input, client });
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
