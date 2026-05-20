/// <reference lib="deno.ns" />

import { Resend } from 'npm:resend@4.6.0';

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SIGNUP_NOTIFICATION_TRIGGER_SECRET = Deno.env.get('SIGNUP_NOTIFICATION_TRIGGER_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL =
  Deno.env.get('RESEND_FROM_EMAIL') ?? 'Overlord Signup <ovld@notifications.cooperativ.io>';
const SIGNUP_NOTIFICATION_TO = 'ovld-signup@cooperativ.io';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

type SignupNotificationPayload = {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  provider?: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKey = req.headers.get('apikey')?.trim() ?? '';
  const token = bearerToken || apiKey;

  if (!token) {
    return false;
  }

  return (
    token === SUPABASE_SERVICE_ROLE_KEY ||
    (!!SIGNUP_NOTIFICATION_TRIGGER_SECRET && token === SIGNUP_NOTIFICATION_TRIGGER_SECRET)
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!RESEND_API_KEY) {
    console.error('[send-signup-notification] Missing RESEND_API_KEY');
    return jsonResponse({ error: 'Function is not configured' }, 500);
  }

  let payload: SignupNotificationPayload;
  try {
    payload = (await req.json()) as SignupNotificationPayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const email = payload.email?.trim() ?? '';
  if (!email) {
    return jsonResponse({ error: 'email is required' }, 400);
  }

  const name = payload.name?.trim() || 'Unknown';
  const provider = payload.provider?.trim() || 'email';
  const resend = new Resend(RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: [SIGNUP_NOTIFICATION_TO],
      replyTo: email,
      subject: `New Overlord signup: ${email}`,
      text: [
        'New Overlord signup',
        `Email: ${email}`,
        `Name: ${name}`,
        `Provider: ${provider}`,
        `User ID: ${payload.userId?.trim() || 'Unknown'}`
      ].join('\n'),
      html: `
        <h1>New Overlord signup</h1>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Provider:</strong> ${escapeHtml(provider)}</p>
        <p><strong>User ID:</strong> ${escapeHtml(payload.userId?.trim() || 'Unknown')}</p>
      `
    });
  } catch (error) {
    console.error('[send-signup-notification] Failed to send email', error);
    return jsonResponse({ error: 'Failed to send signup notification' }, 500);
  }

  return jsonResponse({ ok: true });
});
