import { recordChange } from '../change-feed.js';
import type { ServiceContext } from '../context.js';
import { ServiceError } from '../errors.js';
import { newId, nowIso } from '../util.js';

import type { AgentSessionChannelRow } from './channels.js';

/**
 * Normalized session events — the durable append path behind the activity feed.
 *
 * Two properties do the work here.
 *
 * **Idempotence.** Delivery is at least once by design: a hook may be retried, a sidecar may
 * reconnect and replay, a flaky network may deliver twice. `(channel_id, adapter_key,
 * producer_event_id)` is unique, so a replayed event is a no-op that returns the original row
 * rather than a second card in the feed. Adapters therefore never need dedupe logic, which is
 * good, because five adapters would get it wrong five different ways.
 *
 * **Server-side bounds.** The adapter redacts first, on the machine, before transmission. This
 * layer does not trust that: it applies a second allowlist and bounds every string it stores.
 * A native payload is untrusted model/harness input, and "the adapter already sanitized it" is
 * a claim about code running outside this trust boundary.
 *
 * Phase 0B lands the durable append. The pure normalization (`envelope.ts`, `redact.ts`,
 * `describe/*`) and the Claude/OpenCode producers land in Phase 1; until then this is a correct
 * store with no producers, which is the right order — an event path that persists before it is
 * bounded is the failure mode this design exists to avoid.
 */

export const MAX_EVENT_SUMMARY_LENGTH = 2000;
export const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024;
export const MAX_EVENT_IDENTIFIER_LENGTH = 200;

export type AgentSessionEventInput = {
  producerEventId: string;
  producerSequence?: number | null;
  occurredAt?: string | null;
  kind: string;
  severity?: string | null;
  actionability?: string | null;
  nativeEvent?: string | null;
  nativeTurnId?: string | null;
  nativeCallId?: string | null;
  subagentId?: string | null;
  correlationId?: string | null;
  origin?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown> | null;
  formatterVersion?: number;
};

export type AppendedAgentSessionEvent = {
  id: string;
  channelSequence: number;
  duplicate: boolean;
};

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function requiredIdentifier(value: unknown, field: string): string {
  const bounded = boundedText(value, MAX_EVENT_IDENTIFIER_LENGTH);
  if (!bounded) {
    throw new ServiceError(`${field} is required`, 'invalid_event', 400);
  }
  return bounded;
}

/**
 * Bound the payload without inspecting its meaning.
 *
 * Reduction by *kind* belongs to the pure formatters in Phase 1; what belongs here is the
 * structural ceiling that holds regardless of which formatter produced the object, including a
 * formatter that has not been written yet. An oversize payload is rejected rather than
 * truncated: silently storing half a JSON object produces a card that reads as complete and is
 * not.
 */
function boundedPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return '{}';
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_PAYLOAD_BYTES) {
    throw new ServiceError(
      `Event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`,
      'event_payload_too_large',
      413
    );
  }
  return serialized;
}

function normalizeTimestamp(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  // A harness clock ahead of the server's would sort future events above everything else
  // forever. Trust the producer's ordering, not its absolute time.
  return parsed > new Date(fallback) ? fallback : parsed.toISOString();
}

export async function appendSessionEvent({
  ctx,
  channel,
  event
}: {
  ctx: ServiceContext;
  channel: AgentSessionChannelRow;
  event: AgentSessionEventInput;
}): Promise<AppendedAgentSessionEvent> {
  const adapterKey = channel.adapter_key ?? channel.agent_identifier ?? 'unknown';
  const producerEventId = requiredIdentifier(event.producerEventId, 'producerEventId');
  const kind = requiredIdentifier(event.kind, 'kind');

  const existing = await ctx.db.get<{ id: string; channel_sequence: number }>(
    `SELECT id, channel_sequence FROM agent_session_events
       WHERE channel_id = ? AND adapter_key = ? AND producer_event_id = ?`,
    [channel.id, adapterKey, producerEventId]
  );
  if (existing) {
    return { id: existing.id, channelSequence: existing.channel_sequence, duplicate: true };
  }

  const now = nowIso();
  const id = newId();
  const payloadJson = boundedPayload(event.payload);
  const summary = boundedText(event.summary, MAX_EVENT_SUMMARY_LENGTH);

  const inserted = await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const head = await tx.get<{ next_sequence: number | null }>(
      `SELECT MAX(channel_sequence) AS next_sequence FROM agent_session_events
         WHERE channel_id = ?`,
      [channel.id]
    );
    const channelSequence = (head?.next_sequence ?? 0) + 1;

    await tx.run(
      `INSERT INTO agent_session_events (
           id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
           adapter_key, producer_event_id, producer_sequence, channel_sequence,
           occurred_at, received_at, kind, severity, actionability,
           native_event, native_turn_id, native_call_id, subagent_id, correlation_id, origin,
           summary, payload_json, formatter_version, created_at, updated_at, revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        channel.workspace_id,
        channel.project_id,
        channel.mission_id,
        channel.objective_id,
        channel.id,
        channel.session_id,
        adapterKey,
        producerEventId,
        typeof event.producerSequence === 'number' ? event.producerSequence : null,
        channelSequence,
        normalizeTimestamp(event.occurredAt, now),
        now,
        kind,
        boundedText(event.severity, 32) ?? 'notice',
        boundedText(event.actionability, 32),
        boundedText(event.nativeEvent, MAX_EVENT_IDENTIFIER_LENGTH),
        boundedText(event.nativeTurnId, MAX_EVENT_IDENTIFIER_LENGTH),
        boundedText(event.nativeCallId, MAX_EVENT_IDENTIFIER_LENGTH),
        boundedText(event.subagentId, MAX_EVENT_IDENTIFIER_LENGTH),
        boundedText(event.correlationId, MAX_EVENT_IDENTIFIER_LENGTH),
        boundedText(event.origin, 32),
        summary,
        payloadJson,
        event.formatterVersion ?? 1,
        now,
        now
      ]
    );

    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session_event',
      entityId: id,
      operation: 'insert',
      entityRevision: 1,
      projectId: channel.project_id,
      missionId: channel.mission_id,
      objectiveId: channel.objective_id
    });

    return channelSequence;
  });

  return { id, channelSequence: inserted, duplicate: false };
}

/**
 * Producer-sequence gaps, for diagnostics only.
 *
 * A gap is recorded and surfaced; it never blocks a later event. Arrival order across producers
 * is not treated as a causal order, so "we are missing #7" is information about one producer's
 * delivery, not a reason to stall the feed.
 */
export async function producerSequenceGaps({
  ctx,
  channelId
}: {
  ctx: ServiceContext;
  channelId: string;
}): Promise<{ adapterKey: string; expected: number; observed: number }[]> {
  const rows = await ctx.db.all<{ adapter_key: string; producer_sequence: number }>(
    `SELECT adapter_key, producer_sequence FROM agent_session_events
       WHERE channel_id = ? AND producer_sequence IS NOT NULL
       ORDER BY adapter_key ASC, producer_sequence ASC`,
    [channelId]
  );
  const gaps: { adapterKey: string; expected: number; observed: number }[] = [];
  const previous = new Map<string, number>();
  for (const row of rows) {
    const last = previous.get(row.adapter_key);
    if (last !== undefined && row.producer_sequence > last + 1) {
      gaps.push({
        adapterKey: row.adapter_key,
        expected: last + 1,
        observed: row.producer_sequence
      });
    }
    previous.set(row.adapter_key, row.producer_sequence);
  }
  return gaps;
}
