import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sends a push notification to all mobile devices registered to the organization.
 * Fire-and-forget — logs errors but never throws.
 */
export async function sendPushNotification(
  supabase: SupabaseClient,
  options: {
    title: string;
    body: string;
    organizationId: number;
    data?: Record<string, unknown>;
  }
) {
  try {
    await supabase.functions.invoke('send-push-notification', {
      body: {
        title: options.title,
        body: options.body,
        organizationId: options.organizationId,
        data: options.data
      }
    });
  } catch (err) {
    console.error('[push-notification] failed to send:', err);
    Sentry.captureException(err, { extra: { organizationId: options.organizationId } });
  }
}
