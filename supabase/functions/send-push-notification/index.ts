/// <reference lib="deno.ns" />
/**
 * send-push-notification — Supabase Edge Function
 *
 * Sends Expo push notifications to all users who have registered push tokens.
 * Called from protocol endpoints when notification-worthy ticket events occur
 * (deliver, question, agent_notification alerts).
 *
 * Expected body:
 *   { title: string, body: string, organizationId: number, data?: Record<string, unknown> }
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

interface PushPayload {
  title: string;
  body: string;
  organizationId: number;
  data?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { title, body, organizationId, data } = (await req.json()) as PushPayload;

    if (!title || !body || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'title, body, and organizationId are required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch push tokens for members of this organization
    const { data: memberUserIds, error: membersError } = await supabase
      .from('members')
      .select('user_id')
      .eq('organization_id', organizationId);

    if (membersError) {
      console.error('[send-push-notification] members fetch error:', membersError.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch organization members' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const userIds = (memberUserIds ?? []).map((m) => m.user_id);
    if (userIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const { data: tokens, error: tokensError } = await supabase
      .from('push_tokens')
      .select('token')
      .in('user_id', userIds);

    if (tokensError) {
      console.error('[send-push-notification] token fetch error:', tokensError.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch push tokens' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Build Expo push messages
    const messages = tokens.map(({ token }) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: data ?? {}
    }));

    // Send in chunks of 100 (Expo limit)
    const chunks: typeof messages[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    let totalSent = 0;
    for (const chunk of chunks) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(chunk)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[send-push-notification] Expo push error:', errorText);
        continue;
      }

      const result = await response.json();

      // Clean up invalid tokens
      if (result.data && Array.isArray(result.data)) {
        for (let i = 0; i < result.data.length; i++) {
          const ticket = result.data[i];
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            const invalidToken = chunk[i].to;
            console.log('[send-push-notification] removing invalid token:', invalidToken);
            await supabase.from('push_tokens').delete().eq('token', invalidToken);
          }
        }
      }

      totalSent += chunk.length;
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[send-push-notification] error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
});
