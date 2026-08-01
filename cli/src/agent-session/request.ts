import {
  decodeDecisionRequest,
  encodeDecisionResponse
} from '@overlord/core/service/agent-session/pure/decision';

import { resolveAgentSessionScope } from './bind.js';
import { createChannelClient } from './client.js';
import { findAgentSessionDecisionCodec } from './decision-codec-registry.generated.js';
import { parseNativePayload, readBoundedPayloadFile } from './event.js';

type NativeRequest = {
  kind: 'permission';
  summary: string;
  details: Record<string, unknown>;
  nativeRequestId: string | null;
  nativeCallId: string | null;
  harnessTimeoutSeconds: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Connector-owned native request decoding stays deliberately small and allowlisted. */
export function decodeNativeRequest(agent: string, value: unknown): NativeRequest | null {
  const codec = findAgentSessionDecisionCodec(agent);
  return codec ? decodeDecisionRequest(codec, value) : null;
}

export function encodeNativeDecision(agent: string, resolution: unknown): string | null {
  const record = asRecord(resolution);
  const codec = findAgentSessionDecisionCodec(agent);
  return codec ? encodeDecisionResponse(codec, record?.decision) : null;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Blocking call path. Every non-resolution outcome is deliberately silent: the harness then
 * performs its own prompt/fallback, which is safer than manufacturing a decision.
 */
export async function runAgentSessionRequest({
  agent,
  payloadRaw,
  payloadFile,
  env = process.env
}: {
  agent: string;
  payloadRaw?: string | null;
  payloadFile?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const scope = resolveAgentSessionScope({ agent, env });
  if (!scope) return null;
  const request = decodeNativeRequest(
    agent,
    parseNativePayload(payloadRaw === undefined ? readBoundedPayloadFile(payloadFile) : payloadRaw)
  );
  const baseUrl = env.OVERLORD_BACKEND_URL?.trim();
  if (!request || !baseUrl) return null;
  const client = createChannelClient({ baseUrl, channelId: scope.channelId, token: scope.token });
  const waitMs = Math.max(1_000, Math.floor((request.harnessTimeoutSeconds ?? 35) * 800));
  const deadline = Date.now() + waitMs;
  const created = await client.post<{ requestId: string; status: string }>(
    '/requests',
    {
      ...request,
      // Persist the same deadline this callback actually observes. A request card must never
      // advertise a longer answer window than the native hook that is waiting for it.
      windowExpiresAt: new Date(deadline).toISOString(),
      windowBasis: 'harness_timeout_80_percent'
    },
    { timeoutMs: 3000 }
  );
  if (!created.ok || created.value.status !== 'open') return null;
  let leaseId: string | undefined;
  while (Date.now() < deadline) {
    const lease = await client.post<{ leaseId: string; status: string; resolution: unknown }>(
      `/requests/${created.value.requestId}/lease`,
      leaseId ? { leaseId } : {},
      { timeoutMs: 3000 }
    );
    if (lease.ok) {
      leaseId = lease.value.leaseId;
      if (lease.value.status === 'resolved')
        return encodeNativeDecision(agent, lease.value.resolution);
    } else {
      const current = await client.get<{ status: string; resolution: unknown }>(
        `/requests/${created.value.requestId}`,
        { timeoutMs: 2000 }
      );
      if (current.ok && current.value.status === 'resolved')
        return encodeNativeDecision(agent, current.value.resolution);
      return null;
    }
    await sleep(750);
  }
  const released = await client.post<{ released: boolean; resolution: unknown }>(
    `/requests/${created.value.requestId}/release`,
    { reason: 'timeout' },
    { timeoutMs: 2000 }
  );
  return released.ok && !released.value.released
    ? encodeNativeDecision(agent, released.value.resolution)
    : null;
}
