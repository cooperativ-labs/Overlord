/// <reference lib="deno.ns" />

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'npm:resend@4.6.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL =
  Deno.env.get('RESEND_FROM_EMAIL') ?? 'Overlord <updates@notifications.cooperativ.io>';
const NEWSLETTER_TRIGGER_SECRET = Deno.env.get('NEWSLETTER_TRIGGER_SECRET') ?? '';

const BATCH_SIZE = 100;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const ALLOWED_EMAIL_TYPES = ['new_features'] as const;
type EmailType = (typeof ALLOWED_EMAIL_TYPES)[number];

interface NewsletterPayload {
  subject: string;
  html: string;
  text?: string;
  previewText?: string;
  emailType?: string;
  replyTo?: string;
}

interface MailingListEntry {
  email: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function parseEmailType(value: unknown): EmailType | Response {
  if (value === undefined || value === null) return 'new_features';
  if (typeof value !== 'string' || !(ALLOWED_EMAIL_TYPES as readonly string[]).includes(value)) {
    return jsonResponse(
      { error: `emailType must be one of: ${ALLOWED_EMAIL_TYPES.join(', ')}` },
      400
    );
  }
  return value as EmailType;
}

function mailingListSubscribersQuery(
  supabase: ReturnType<typeof createClient>,
  emailType: EmailType
) {
  const base = supabase.from('mailing_list').select('email').neq('email', '');
  switch (emailType) {
    case 'new_features':
      return base.eq('new_features', true);
    default: {
      const _exhaustive: never = emailType;
      return _exhaustive;
    }
  }
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKey = req.headers.get('apikey')?.trim() ?? '';
  const token = bearerToken || apiKey;
  if (!token) return false;
  return (
    token === SUPABASE_SERVICE_ROLE_KEY ||
    (!!NEWSLETTER_TRIGGER_SECRET && token === NEWSLETTER_TRIGGER_SECRET)
  );
}

function wrapInTemplate(html: string, subject: string, previewText?: string): string {
  const preview = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;">${previewText}&nbsp;</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preview}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#09090b;padding:24px 40px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Overlord</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;color:#18181b;font-size:15px;line-height:1.6;">
              ${html}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background:#fafafa;border-top:1px solid #e4e4e7;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#71717a;">
                You're receiving this because you signed up for Overlord.
              </p>
              <p style="margin:0;font-size:12px;color:#71717a;">
                To update your email preferences, visit your
                <a href="https://overlord.cooperativ.io/settings" style="color:#18181b;text-decoration:underline;">account settings</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
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
    console.error('[send-newsletter] Missing RESEND_API_KEY');
    return jsonResponse({ error: 'Function is not configured' }, 500);
  }

  let payload: NewsletterPayload;
  try {
    payload = (await req.json()) as NewsletterPayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { subject, html, text, previewText, emailType: rawEmailType, replyTo } = payload;

  if (!subject?.trim()) return jsonResponse({ error: 'subject is required' }, 400);
  if (!html?.trim()) return jsonResponse({ error: 'html is required' }, 400);

  const parsedEmailType = parseEmailType(rawEmailType);
  if (parsedEmailType instanceof Response) return parsedEmailType;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { data: subscribers, error: dbError } = await mailingListSubscribersQuery(
    supabase,
    parsedEmailType
  );

  if (dbError) {
    console.error('[send-newsletter] DB error', dbError);
    return jsonResponse({ error: 'Failed to load subscribers' }, 500);
  }

  const emails = (subscribers as MailingListEntry[]).map(r => r.email).filter(Boolean);
  if (emails.length === 0) {
    return jsonResponse({ ok: true, sent: 0, message: 'No opted-in subscribers' });
  }

  const wrappedHtml = wrapInTemplate(html, subject, previewText);
  const resend = new Resend(RESEND_API_KEY);
  const batches = chunk(emails, BATCH_SIZE);

  let sent = 0;
  const errors: string[] = [];

  for (const batch of batches) {
    const messages = batch.map(to => ({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html: wrappedHtml,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {})
    }));

    try {
      const result = await resend.batch.send(messages);
      if (result.error) {
        console.error('[send-newsletter] Batch error', result.error);
        errors.push(result.error.message);
      } else {
        sent += batch.length;
      }
    } catch (err) {
      console.error('[send-newsletter] Batch send threw', err);
      errors.push(String(err));
    }
  }

  if (errors.length > 0 && sent === 0) {
    return jsonResponse({ error: 'All batches failed', details: errors }, 500);
  }

  return jsonResponse({
    ok: true,
    sent,
    total: emails.length,
    ...(errors.length > 0 ? { partialErrors: errors } : {})
  });
});
