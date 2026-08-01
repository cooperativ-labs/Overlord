import {
  type CodecSpec,
  normalizeNativeEvent
} from '@overlord/core/service/agent-session/pure/codec';
import type { NormalizedEvent } from '@overlord/core/service/agent-session/pure/envelope';
import { randomBytes } from 'node:crypto';

import { resolveAgentSessionScope } from './bind.js';
import { type ChannelClient, createChannelClient } from './client.js';
import { findAgentSessionCodec } from './codec-registry.generated.js';
import { type ClaimedInput, injectViaPromptAsync } from './inbox.js';

/**
 * The control-plane sidecar — Shape C's answer to the hook script.
 *
 * A callback harness invokes Overlord; a control-plane harness does not invoke anything. It
 * runs a local HTTP server and publishes an event stream, and integration means being a peer on
 * that stream. So there is no script to install and nothing for the harness to call: Overlord
 * starts this process alongside the agent and it subscribes.
 *
 * This landed in the same phase as the Claude push path deliberately. A normalized-event waist
 * validated against one integration shape encodes that shape, and the cost of discovering that
 * shows up when the second harness arrives — by which time the first one's assumptions are load
 * bearing. Both codecs feeding one envelope is the evidence that the waist is in the right
 * place, and it is asserted by a fixture rather than believed.
 *
 * ## The control port is a credential
 *
 * OpenCode's server accepts commands that drive the agent: running tools, sending prompts,
 * answering permissions. It binds without authentication unless configured otherwise. Anything
 * that can reach the port owns the session, which makes three rules non-negotiable:
 *
 *  1. **Loopback only.** Never the all-interfaces wildcard, never a LAN address, never a
 *     container bridge. A port bound to every interface on a laptop on a café network is a
 *     remote shell that anyone on that network can use.
 *  2. **A per-launch secret.** `OPENCODE_SERVER_PASSWORD` is generated here, held in memory,
 *     and dies with the process. It is not written to disk, not exported into a launch script,
 *     and not reused across sessions.
 *  3. **Never projected to a client.** Browser and mobile surfaces talk to Overlord's own
 *     authenticated API; Overlord talks to the port. Handing a client the port and the secret
 *     would move the trust boundary onto the network for no benefit.
 */

/**
 * The only interface the sidecar may bind. Named as a constant so the source guard fixture has
 * something stable to assert against. A fixture guards the absence of the all-interfaces
 * wildcard in this file, so making the sidecar reachable from the network is not a one-word
 * change someone can make while debugging a container and forget to revert.
 */
export const SIDECAR_BIND_ADDRESS = '127.0.0.1';

/** Reconnect backoff. Bounded: a harness that has exited should not be polled forever. */
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000];

export type SidecarOptions = {
  agent: string;
  port: number;
  /** Injected in tests. Production generates one per launch and never persists it. */
  password?: string;
  env?: NodeJS.ProcessEnv;
  /** Bound for tests; production runs until the stream ends. */
  maxReconnects?: number;
  fetchImpl?: typeof fetch;
};

/** Generate the per-launch control-port secret. In memory only, for the life of the process. */
export function generateServerPassword(): string {
  return randomBytes(32).toString('base64url');
}

export function controlPlaneBaseUrl(port: number): string {
  return `http://${SIDECAR_BIND_ADDRESS}:${port}`;
}

type SseFrame = { event: string | null; data: string };

/**
 * Parse a Server-Sent Events byte stream into frames.
 *
 * Written out rather than pulled from a dependency because the sidecar's whole job is to read
 * this stream correctly, and because a partial frame at a chunk boundary is the bug that would
 * otherwise show up as "events go missing under load" — the buffer below is the fix, and it is
 * worth being able to see it.
 */
export async function* parseSseStream(stream: AsyncIterable<Uint8Array>): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event: string | null = null;
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) yield { event, data: dataLines.join('\n') };
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/**
 * The native event name for a control-plane frame.
 *
 * OpenCode puts the type in the JSON body (`{"type": "message.part.updated", …}`) and, for some
 * transports, in the SSE `event:` field. The body wins when both are present: the SSE field is
 * transport metadata that a proxy may rewrite, and the body is what the harness actually said.
 */
export function frameEventName(frame: SseFrame, body: unknown): string | null {
  if (body && typeof body === 'object' && typeof (body as { type?: unknown }).type === 'string') {
    return (body as { type: string }).type;
  }
  return frame.event;
}

export type SidecarRunResult = {
  posted: number;
  duplicates: number;
  reconnects: number;
  reason: 'no-scope' | 'no-codec' | 'no-backend' | 'stream-ended' | 'reconnect-exhausted';
};

/**
 * Run the sidecar until the harness stream ends.
 *
 * The reconnect path is where the interesting correctness lives. When a sidecar dies and
 * restarts — a crash, a `kill`, a laptop sleeping — it has no idea what its predecessor
 * delivered, so it re-reads `/permission` and `/question` and re-emits what it finds. That is
 * duplicate delivery by construction, and the design absorbs it rather than preventing it:
 * producer event ids are derived from content, so a replayed frame collapses onto the row it
 * already produced. Trying to suppress the replay instead would require the sidecar to remember
 * something across its own death, which is the one thing it cannot do.
 */
export async function runSidecar(options: SidecarOptions): Promise<SidecarRunResult> {
  const env = options.env ?? process.env;
  const scope = resolveAgentSessionScope({ agent: options.agent, env });
  if (!scope) return { posted: 0, duplicates: 0, reconnects: 0, reason: 'no-scope' };

  const codec = findAgentSessionCodec(options.agent);
  if (!codec) return { posted: 0, duplicates: 0, reconnects: 0, reason: 'no-codec' };

  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl) return { posted: 0, duplicates: 0, reconnects: 0, reason: 'no-backend' };

  const client = createChannelClient({
    baseUrl,
    channelId: scope.channelId,
    token: scope.token
  });
  const password = options.password ?? generateServerPassword();
  const doFetch = options.fetchImpl ?? fetch;
  const maxReconnects = options.maxReconnects ?? RECONNECT_DELAYS_MS.length;

  let posted = 0;
  let duplicates = 0;
  let reconnects = 0;
  const openPermissions = new Map<string, string>();
  let nativeSessionId: string | null = null;
  let lastInjectAt = 0;

  for (let attempt = 0; attempt <= maxReconnects; attempt += 1) {
    if (attempt > 0) {
      reconnects += 1;
      // Reconciliation before resubscription. The stream only carries what happens *next*;
      // anything the harness decided while we were dead is only visible in the current state.
      const reconciled = await reconcileState({
        codec,
        client,
        port: options.port,
        password,
        doFetch,
        openPermissions
      });
      posted += reconciled.posted;
      duplicates += reconciled.duplicates;
      await delay(
        RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)] ?? 5000
      );
    }

    let response: Response;
    try {
      response = await doFetch(`${controlPlaneBaseUrl(options.port)}/event`, {
        headers: authHeaders(password)
      });
    } catch {
      continue;
    }
    if (!response.ok || !response.body) continue;

    try {
      for await (const frame of parseSseStream(
        response.body as unknown as AsyncIterable<Uint8Array>
      )) {
        const sessionFromFrame = extractSessionId(frame);
        if (sessionFromFrame) nativeSessionId = sessionFromFrame;
        await syncOpenCodePermission({
          client,
          frame,
          openPermissions,
          port: options.port,
          password,
          doFetch
        });
        const result = await pushFrame({ codec, client, frame });
        if (result === 'posted') posted += 1;
        if (result === 'duplicate') duplicates += 1;

        // Inject path: claim pending inputs and POST prompt_async. Bounded so a busy event
        // stream still drains the inbox without turning the sidecar into a tight poll loop.
        if (nativeSessionId && Date.now() - lastInjectAt > 750) {
          lastInjectAt = Date.now();
          await drainPendingInputs({
            client,
            doFetch,
            port: options.port,
            password,
            sessionId: nativeSessionId
          });
        }
      }
      return { posted, duplicates, reconnects, reason: 'stream-ended' };
    } catch {
      // A broken stream is a reconnect, not a failure. The harness is very likely still alive.
      continue;
    }
  }

  return { posted, duplicates, reconnects, reason: 'reconnect-exhausted' };
}

function extractSessionId(frame: SseFrame): string | null {
  try {
    const body = JSON.parse(frame.data) as unknown;
    if (!body || typeof body !== 'object') return null;
    const record = body as Record<string, unknown>;
    if (typeof record.sessionID === 'string') return record.sessionID;
    const properties = record.properties;
    if (properties && typeof properties === 'object') {
      const sessionID = (properties as Record<string, unknown>).sessionID;
      if (typeof sessionID === 'string') return sessionID;
    }
  } catch {
    return null;
  }
  return null;
}

async function drainPendingInputs({
  client,
  doFetch,
  port,
  password,
  sessionId
}: {
  client: ChannelClient;
  doFetch: typeof fetch;
  port: number;
  password: string;
  sessionId: string;
}): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const claimed = await client.post<{ input: ClaimedInput | null }>(
      '/inputs/claim',
      {},
      {
        timeoutMs: 3000
      }
    );
    if (!claimed.ok || !claimed.value.input) return;
    await injectViaPromptAsync({
      client,
      controlFetch: doFetch,
      controlBaseUrl: controlPlaneBaseUrl(port),
      password,
      sessionId,
      input: claimed.value.input
    });
  }
}

function authHeaders(password: string): Record<string, string> {
  // The per-launch secret travels in a header on a loopback request, never in the URL and never
  // in argv — the same rule the channel credential follows, for the same reason.
  return { authorization: `Bearer ${password}` };
}

async function pushFrame({
  codec,
  client,
  frame
}: {
  codec: CodecSpec;
  client: ChannelClient;
  frame: SseFrame;
}): Promise<'posted' | 'duplicate' | 'skipped'> {
  let body: unknown;
  try {
    body = JSON.parse(frame.data);
  } catch {
    return 'skipped';
  }
  const event = safeNormalize({ codec, body, nativeEventName: frameEventName(frame, body) });
  if (!event) return 'skipped';
  const result = await client.post<{ accepted: { duplicate: boolean }[] }>('/events', {
    events: [event]
  });
  if (!result.ok) return 'skipped';
  return result.value.accepted?.[0]?.duplicate ? 'duplicate' : 'posted';
}

function safeNormalize({
  codec,
  body,
  nativeEventName
}: {
  codec: CodecSpec;
  body: unknown;
  nativeEventName: string | null;
}): NormalizedEvent | null {
  try {
    return normalizeNativeEvent({
      codec,
      payload: body,
      nativeEventName,
      occurredAt: new Date().toISOString()
    });
  } catch {
    return null;
  }
}

/**
 * Re-read the harness's current state after a reconnect.
 *
 * `/permission` and `/question` are the two endpoints whose contents are *state* rather than
 * history: a permission raised while the sidecar was dead is still open, still blocking the
 * agent, and will never be re-announced on the stream. Everything else can be allowed to have
 * been missed, because a missed tool-completion event costs a feed row and a missed permission
 * costs a stalled session with nobody watching.
 */
async function reconcileState({
  codec,
  client,
  port,
  password,
  doFetch,
  openPermissions
}: {
  codec: CodecSpec;
  client: ChannelClient;
  port: number;
  password: string;
  doFetch: typeof fetch;
  openPermissions: Map<string, string>;
}): Promise<{ posted: number; duplicates: number }> {
  let posted = 0;
  let duplicates = 0;
  for (const path of ['/permission', '/question']) {
    let entries: unknown[];
    try {
      const response = await doFetch(`${controlPlaneBaseUrl(port)}${path}`, {
        headers: authHeaders(password)
      });
      if (!response.ok) continue;
      const parsed = (await response.json()) as unknown;
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (path === '/permission') {
        await syncOpenCodePermission({
          client,
          frame: { event: 'permission.updated', data: JSON.stringify(entry) },
          openPermissions,
          port,
          password,
          doFetch
        });
      }
      const result = await pushFrame({
        codec,
        client,
        frame: { event: null, data: JSON.stringify(entry) }
      });
      if (result === 'posted') posted += 1;
      if (result === 'duplicate') duplicates += 1;
    }
  }
  return { posted, duplicates };
}

/**
 * Permissions are durable OpenCode control-plane objects, unlike callback hooks. A native TUI
 * answer therefore has an observable loser: we close the corresponding remote card as
 * `resolved_elsewhere` rather than pretending the human's remote control still applies.
 */
async function syncOpenCodePermission({
  client,
  frame,
  openPermissions,
  port,
  password,
  doFetch
}: {
  client: ChannelClient;
  frame: SseFrame;
  openPermissions: Map<string, string>;
  port: number;
  password: string;
  doFetch: typeof fetch;
}): Promise<void> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(frame.data) as unknown;
    body =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  } catch {
    return;
  }
  const event = frameEventName(frame, body);
  const properties =
    body?.properties && typeof body.properties === 'object'
      ? (body.properties as Record<string, unknown>)
      : body;
  const nativeId = typeof properties?.id === 'string' ? properties.id : null;
  if (!nativeId || !event?.startsWith('permission')) return;
  const resolved =
    event.includes('replied') || event.includes('resolved') || properties?.status === 'resolved';
  if (resolved) {
    const requestId = openPermissions.get(nativeId);
    if (requestId) {
      await client.post(`/requests/${encodeURIComponent(requestId)}/resolved-elsewhere`, {});
      openPermissions.delete(nativeId);
    }
    return;
  }
  if (openPermissions.has(nativeId)) return;
  const created = await client.post<{ requestId: string }>('/requests', {
    kind: 'permission',
    nativeRequestId: nativeId,
    summary: 'OpenCode permission request',
    options: [
      { optionId: 'allow', label: 'Allow once', kind: 'allow' },
      { optionId: 'deny', label: 'Deny', kind: 'deny' }
    ]
  });
  if (created.ok) {
    openPermissions.set(nativeId, created.value.requestId);
    void waitForRemoteOpenCodeResolution({
      client,
      requestId: created.value.requestId,
      nativeId,
      port,
      password,
      doFetch,
      openPermissions
    });
  }
}

async function waitForRemoteOpenCodeResolution({
  client,
  requestId,
  nativeId,
  port,
  password,
  doFetch,
  openPermissions
}: {
  client: ChannelClient;
  requestId: string;
  nativeId: string;
  port: number;
  password: string;
  doFetch: typeof fetch;
  openPermissions: Map<string, string>;
}): Promise<void> {
  // The durable request is the source of truth. Polling it does not own the native permission;
  // it merely observes a remote answer, which is why a simultaneous TUI answer can still win.
  for (
    let attempt = 0;
    attempt < 2_400 && openPermissions.get(nativeId) === requestId;
    attempt += 1
  ) {
    await delay(750);
    const current = await client.get<{ status: string; resolution: unknown }>(
      `/requests/${requestId}`
    );
    if (!current.ok || current.value.status !== 'resolved') {
      if (current.ok && current.value.status !== 'open') openPermissions.delete(nativeId);
      continue;
    }
    const resolution = current.value.resolution;
    const decision =
      resolution && typeof resolution === 'object'
        ? (resolution as Record<string, unknown>).decision
        : null;
    if (decision !== 'allow' && decision !== 'deny') return;
    try {
      await doFetch(
        `${controlPlaneBaseUrl(port)}/permission/${encodeURIComponent(nativeId)}/reply`,
        {
          method: 'POST',
          headers: { ...authHeaders(password), 'content-type': 'application/json' },
          body: JSON.stringify({ reply: decision })
        }
      );
      await client.post(`/requests/${requestId}/application`, { applicationState: 'emitted' });
    } catch {
      // The native permission remains authoritative; do not retry an emitted decision blindly.
    }
    return;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
