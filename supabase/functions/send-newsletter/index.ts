/// <reference lib="deno.ns" />

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'npm:resend@4.6.0';

import { changelogEmailTemplate, fillTemplateTags, wrapInTemplate } from './template.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL = 'Overlord Updates <updates@notifications.cooperativ.io>';
const NEWSLETTER_TRIGGER_SECRET = Deno.env.get('NEWSLETTER_TRIGGER_SECRET') ?? '';

const APP_URL = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'https://www.ovld.ai';

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
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }).format(new Date(entry.published_at))
      : new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }).format(new Date());

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
  let isFullChangelogTemplate = false;
  if (!templateHtml) {
    if (payload.changelogId) {
      templateHtml = changelogEmailTemplate();
      isFullChangelogTemplate = true;
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
      const recipientWrappedHtml = isFullChangelogTemplate
        ? recipientHtml
        : wrapInTemplate({
            html: recipientHtml,
            subject: emailSubject,
            appUrl: APP_URL,
            previewText: emailPreviewText,
            unsubscribeUrl: unsub
          });
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
