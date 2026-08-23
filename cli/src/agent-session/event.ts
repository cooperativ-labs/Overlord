import {
  type CodecSpec,
  normalizeNativeEvent,
  resolveNativeSessionId
} from '@overlord/core/service/agent-session/pure/codec';
import type { NormalizedEvent } from '@overlord/core/service/agent-session/pure/envelope';

import { readBoundedUtf8File, readBoundedUtf8FromDescriptor } from '../local-file-storage.js';

import { resolveAgentSessionScope } from './bind.js';
import { createChannelClient } from './client.js';
import { findAgentSessionCodec } from './codec-registry.generated.js';

/**
 * `ovld agent-session event` — the push path.
 *
 * Four steps, in this order, and the order is the design:
 *
 *   gate → reduce → post → exit
 *
 * **Gate first.** Before a byte is logged, a file is written, or a socket is opened, this
 * process asks whether it belongs to an Overlord session at all. An unbound session — someone's
 * own agent in an unrelated directory on a machine that happens to have Overlord installed —
 * must produce nothing observable. The rendered hook script already gated in bash before
 * spawning us, so in practice we are rarely reached without a channel; this is the second of
 * two gates because the one that can be bypassed by invoking the CLI directly is not a gate.
 *
 * **Reduce on the machine.** The native payload never leaves. What leaves is a normalized
 * envelope built by the pure core: a tool name from a closed vocabulary, a derived summary, and
 * structural key names. Sending the raw payload for the server to summarize would defeat the
 * entire privacy property, and it is the kind of shortcut that looks like an optimization.
 *
 * **Never speak.** Push is observational: it must not block, must not print, and must not fail
 * a session. Every error path here is `return` — no stderr, no log file, no retry storm. A
 * diagnostic printed into a hook's stderr *is* output, and output from an observational hook is
 * a bug in exactly the place a user cannot debug it.
 *
 * **Exit 0, always.** For an event registration, a nonzero exit is a harness-visible failure
 * for something the harness never asked us to do.
 */

/** Hard ceiling on the payload we will read from stdin. */
export const MAX_AGENT_SESSION_PAYLOAD_BYTES = 1024 * 1024;

/** Bounded because a hook sits in front of a human. A slow event is worse than a lost one. */
const POST_TIMEOUT_MS = 3000;

export type AgentSessionEventOutcome =
  | 'no-scope'
  | 'no-codec'
  | 'no-payload'
  | 'not-mapped'
  | 'no-backend'
  | 'posted'
  | 'dropped';

/**
 * Read the native payload without ever holding an unbounded string.
 *
 * Streaming from stdin rather than argv is a security property (argv is world-readable in `ps`)
 * and a correctness one (argv has a size limit and mangles NUL bytes). The size ceiling is here
 * because the payload is untrusted input from a process we do not control.
 */
export function readBoundedStdin(
  maxBytes = MAX_AGENT_SESSION_PAYLOAD_BYTES,
  fileDescriptor = 0
): string | null {
  const raw = readBoundedUtf8FromDescriptor(fileDescriptor, maxBytes);
  return raw ? raw : null;
}

/**
 * Read a native payload from the declared runtime flag.
 *
 * Callback hooks stream on stdin (`-`). Pi's in-process extension has no stdin option on its
 * sanctioned `pi.exec` API, so it writes an owner-only, short-lived file and passes that path.
 * The same byte ceiling and parse behavior apply on both paths; the extension removes its file
 * in a `finally` block, and this runtime never persists it.
 */
export function readBoundedPayloadFile(payloadFile: string | null | undefined): string | null {
  if (!payloadFile || payloadFile === '-') return readBoundedStdin();
  const raw = readBoundedUtf8File(payloadFile, MAX_AGENT_SESSION_PAYLOAD_BYTES);
  return raw ? raw : null;
}

/**
 * Parse a native payload, tolerating everything.
 *
 * A malformed payload is dropped after no diagnostic at all. It is tempting to log the payload
 * that failed to parse — that is precisely the raw native content §9 forbids persisting, and a
 * parse failure is not a good enough reason to make an exception on the one path where the
 * content is most likely to be something unexpected.
 */
export function parseNativePayload(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Normalize a native payload into an envelope using the adapter's compiled codec.
 *
 * Exported for the parity tests, which need to assert what the runtime produces without
 * standing up a backend.
 */
export function normalizeForAdapter({
  codec,
  payload,
  nativeEventName,
  now = new Date()
}: {
  codec: CodecSpec;
  payload: unknown;
  nativeEventName?: string | null;
  now?: Date;
}): NormalizedEvent | null {
  try {
    return normalizeNativeEvent({
      codec,
      payload,
      nativeEventName: nativeEventName ?? null,
      occurredAt: now.toISOString()
    });
  } catch {
    // A codec that throws produces no event rather than a malformed one. The alternative —
    // emitting a partial envelope — puts a card in a feed that says something we did not derive.
    return null;
  }
}

export async function runAgentSessionEvent({
  agent,
  payloadRaw,
  payloadFile,
  env = process.env
}: {
  agent: string;
  /** Injected by tests; production reads stdin. */
  payloadRaw?: string | null;
  /** `-` streams stdin; an in-process adapter may provide an owner-only ephemeral file. */
  payloadFile?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<AgentSessionEventOutcome> {
  // ── Gate ───────────────────────────────────────────────────────────────────
  const scope = resolveAgentSessionScope({ agent, env });
  if (!scope) return 'no-scope';

  const codec = findAgentSessionCodec(agent);
  if (!codec) return 'no-codec';

  const payload = parseNativePayload(
    payloadRaw === undefined ? readBoundedPayloadFile(payloadFile) : payloadRaw
  );
  if (payload === null) return 'no-payload';

  // ── Reduce ─────────────────────────────────────────────────────────────────
  const event = normalizeForAdapter({ codec, payload });
  if (!event) return 'not-mapped';

  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!baseUrl) return 'no-backend';

  // ── Post ───────────────────────────────────────────────────────────────────
  const client = createChannelClient({
    baseUrl,
    channelId: scope.channelId,
    token: scope.token
  });
  const result = await client.post(
    '/events',
    {
      // The native session id rides along on every event so a pre-attach event can be bound to
      // its session retroactively. It is an alias, never an authorization: the credential in
      // the Authorization header is what the server checks.
      nativeSessionId: resolveNativeSessionIdSafely(codec, payload) ?? scope.nativeSessionId,
      events: [event]
    },
    { timeoutMs: POST_TIMEOUT_MS }
  );
  return result.ok ? 'posted' : 'dropped';
}

function resolveNativeSessionIdSafely(codec: CodecSpec, payload: unknown): string | null {
  try {
    return resolveNativeSessionId(codec, payload);
  } catch {
    return null;
  }
}
