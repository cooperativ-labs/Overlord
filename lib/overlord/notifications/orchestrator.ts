import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type ObjectiveNotificationIntent,
  resolveObjectiveNotificationIntent
} from '@/lib/overlord/objective-notifications';
import { sendPushNotification } from '@/lib/overlord/push-notifications';
import type { Database } from '@/types/database.types';

type TicketEventRow = Database['public']['Tables']['ticket_events']['Row'];

/**
 * Minimal shape required to classify a workflow event without forcing
 * callers to read the row back from the database after inserting it.
 * Mirrors the fields the classifier inspects.
 */
export type WorkflowNotificationEvent = {
  id?: string | null;
  event_type: TicketEventRow['event_type'];
  is_blocking?: boolean | null;
  payload?: TicketEventRow['payload'] | unknown;
  phase?: TicketEventRow['phase'] | null;
  summary?: string | null;
};

export type WorkflowNotificationInput = {
  supabase: SupabaseClient;
  event: WorkflowNotificationEvent;
  organizationId: number;
  ticketId: string;
  ticketReference: string;
  ticketTitle?: string | null;
  objectiveId?: string | null;
};

export type WorkflowNotificationResult =
  | { sent: false; reason: 'no_intent' }
  | { sent: true; intent: ObjectiveNotificationIntent };

/**
 * Single server-side entry point for sending mobile push notifications driven
 * by workflow state changes. Resolves the normalized notification intent via
 * the shared classifier and forwards a consistent push payload that mirrors
 * what the in-app realtime consumers render. Fire-and-forget — never throws.
 */
export async function emitWorkflowNotification(
  input: WorkflowNotificationInput
): Promise<WorkflowNotificationResult> {
  const intent = resolveObjectiveNotificationIntent(input.event as TicketEventRow, {
    ticketReference: input.ticketReference,
    ticketTitle: input.ticketTitle ?? null
  });

  if (!intent) {
    return { sent: false, reason: 'no_intent' };
  }

  await sendPushNotification(input.supabase, {
    title: intent.title,
    body: intent.body,
    organizationId: input.organizationId,
    data: {
      ticketId: input.ticketId,
      objectiveId: input.objectiveId ?? null,
      eventId: input.event.id ?? null,
      eventType: input.event.event_type,
      intent: intent.kind,
      sound: intent.sound
    }
  });

  return { sent: true, intent };
}
