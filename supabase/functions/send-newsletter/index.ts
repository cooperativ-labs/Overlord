/// <reference lib="deno.ns" />

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'npm:resend@4.6.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL =
  Deno.env.get('RESEND_FROM_EMAIL') ?? 'Overlord <updates@notifications.cooperativ.io>';
const NEWSLETTER_TRIGGER_SECRET = Deno.env.get('NEWSLETTER_TRIGGER_SECRET') ?? '';

const APP_URL = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'https://overlord.cooperativ.io';

const BATCH_SIZE = 100;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const ALLOWED_EMAIL_TYPES = ['new_features'] as const;
type EmailType = (typeof ALLOWED_EMAIL_TYPES)[number];

interface NewsletterPayload {
  subject?: string;
  html?: string;
  text?: string;
  previewText?: string;
  emailType?: string;
  replyTo?: string;
  changelogId?: string;
  variables?: {
    title?: string;
    date?: string;
    summary?: string;
    body_html?: string;
    permalink?: string;
  };
}

interface MailingListEntry {
  email: string;
  user_id: string;
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

function mailingListSubscribersQuery(supabase: SupabaseClient, emailType: EmailType) {
  const base = supabase.from('mailing_list').select('email, user_id').neq('email', '');
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

function escapeHtmlAttributeSafe(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillTemplateTags(
  template: string,
  vars: {
    title: string;
    date: string;
    summary: string;
    body_html: string;
    permalink: string;
    unsubscribe_url: string;
    recipient_name: string;
  }
): string {
  const escaped = {
    title: escapeHtmlAttributeSafe(vars.title),
    date: escapeHtmlAttributeSafe(vars.date),
    summary: escapeHtmlAttributeSafe(vars.summary),
    body_html: vars.body_html,
    permalink: escapeHtmlAttributeSafe(vars.permalink),
    unsubscribe_url: escapeHtmlAttributeSafe(vars.unsubscribe_url),
    recipient_name: escapeHtmlAttributeSafe(vars.recipient_name)
  };

  return template
    .replace(/\{\{\{\s*body_html\s*\}\}\}/g, escaped.body_html)
    .replace(/\{\{\s*body_html\s*\}\}/g, escaped.body_html)
    .replace(/\{\{\s*title\s*\}\}/g, escaped.title)
    .replace(/\{\{\s*date\s*\}\}/g, escaped.date)
    .replace(/\{\{\s*summary\s*\}\}/g, escaped.summary)
    .replace(/\{\{\s*permalink\s*\}\}/g, escaped.permalink)
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, escaped.unsubscribe_url)
    .replace(/\{\{\s*recipient_name\s*\}\}/g, escaped.recipient_name);
}

function wrapInTemplate(
  html: string,
  subject: string,
  previewText?: string,
  unsubscribeUrl?: string
): string {
  const preview = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;">${previewText}&nbsp;</div>`
    : '';
  const unsubLink = unsubscribeUrl ?? `${APP_URL}/settings`;
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
                To stop receiving these emails, you can
                <a href="${unsubLink}" style="color:#18181b;text-decoration:underline;">unsubscribe</a> at any time.
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

  const parsedEmailType = parseEmailType(rawEmailType);
  if (parsedEmailType instanceof Response) return parsedEmailType;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  // 1. Fetch subscribers
  const { data: subscribers, error: dbError } = await mailingListSubscribersQuery(
    supabase,
    parsedEmailType
  );

  if (dbError) {
    console.error('[send-newsletter] DB error', dbError);
    return jsonResponse({ error: 'Failed to load subscribers' }, 500);
  }

  const emailList = subscribers as MailingListEntry[];
  const emails = emailList.map(r => r.email).filter(Boolean);
  if (emails.length === 0) {
    return jsonResponse({ ok: true, sent: 0, message: 'No opted-in subscribers' });
  }

  // 2. Fetch profiles to retrieve names
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, name');

  if (profileError) {
    console.warn('[send-newsletter] Failed to fetch profiles for recipient names', profileError);
  }

  const profileMap = new Map<string, string>();
  if (profiles) {
    for (const p of profiles) {
      profileMap.set(p.id, p.name);
    }
  }

  const getRecipientName = (userId: string, email: string): string => {
    const name = profileMap.get(userId)?.trim();
    if (name) return name;
    const emailParts = email.split('@');
    if (emailParts.length > 0 && emailParts[0]) {
      return emailParts[0];
    }
    return 'there';
  };

  // 3. Resolve template variables
  let vars = {
    title: payload.variables?.title ?? '',
    date: payload.variables?.date ?? '',
    summary: payload.variables?.summary ?? '',
    body_html: payload.variables?.body_html ?? '',
    permalink: payload.variables?.permalink ?? ''
  };

  let emailSubject = subject;
  let emailPreviewText = previewText;

  if (payload.changelogId) {
    const { data: entry, error: entryError } = await supabase
      .from('changelog_entries')
      .select('*')
      .eq('id', payload.changelogId)
      .single();

    if (entryError || !entry) {
      console.error('[send-newsletter] Failed to load changelog entry', entryError);
      return jsonResponse({ error: 'Failed to load changelog entry' }, 404);
    }

    const publishedDate = entry.published_at
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(entry.published_at))
      : new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date());

    vars = {
      title: entry.title,
      date: publishedDate,
      summary: entry.summary ?? '',
      body_html: entry.body_html ?? '',
      permalink: `${APP_URL}/changelog/${entry.slug}`
    };

    if (!emailSubject) {
      emailSubject = entry.title;
    }
    if (!emailPreviewText) {
      emailPreviewText = entry.summary ?? undefined;
    }
  }

  if (!emailSubject?.trim()) {
    return jsonResponse({ error: 'subject is required (or a valid changelogId)' }, 400);
  }

  // 4. Resolve default HTML template if none is passed
  let templateHtml = html ?? '';
  if (!templateHtml) {
    if (payload.changelogId) {
      templateHtml = `
        <h2 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#09090b;">{{ title }}</h2>
        <p style="font-size:13px;color:#71717a;margin:0 0 24px;">Published on {{ date }}</p>
        ${vars.summary ? `<p style="font-size:16px;line-height:1.6;color:#27272a;margin:0 0 24px;font-weight:500;">{{ summary }}</p>` : ''}
        <div style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">
          {{{ body_html }}}
        </div>
        <p style="margin:24px 0 0;">
          <a href="{{ permalink }}" style="display:inline-block;background:#09090b;color:#ffffff;padding:12px 24px;font-size:14px;font-weight:500;text-decoration:none;border-radius:6px;">View Full Release Notes</a>
        </p>
      `;
    } else {
      return jsonResponse({ error: 'html template is required (or a valid changelogId)' }, 400);
    }
  }

  const resend = new Resend(RESEND_API_KEY);
  const batches = chunk(emails, BATCH_SIZE);

  let sent = 0;
  const errors: string[] = [];

  for (const batch of batches) {
    const messages = batch.map(to => {
      const subscriber = emailList.find(s => s.email === to);
      const userId = subscriber?.user_id ?? '';
      const name = getRecipientName(userId, to);
      const unsub = `${APP_URL}/unsubscribe?email=${encodeURIComponent(to)}`;

      const personalVars = {
        ...vars,
        unsubscribe_url: unsub,
        recipient_name: name
      };

      const recipientHtml = fillTemplateTags(templateHtml, personalVars);
      const recipientWrappedHtml = wrapInTemplate(
        recipientHtml,
        emailSubject,
        emailPreviewText,
        unsub
      );
      const recipientText = text ? fillTemplateTags(text, personalVars) : undefined;

      return {
        from: RESEND_FROM_EMAIL,
        to,
        subject: emailSubject,
        html: recipientWrappedHtml,
        ...(recipientText ? { text: recipientText } : {}),
        ...(replyTo ? { replyTo } : {})
      };
    });

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
