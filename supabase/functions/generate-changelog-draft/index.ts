/// <reference lib="deno.ns" />
/**
 * generate-changelog-draft — Supabase Edge Function
 *
 * Reads feed_posts since the last published changelog entry and uses Gemini to
 * draft user-facing release notes (title, summary, markdown body, slug).
 * Returns the draft to the caller; persistence happens in the Next.js server
 * action so DB schema concerns live in one place.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const ADMIN_EMAIL = 'jake@cooperativ.io';
const DEFAULT_LOOKBACK_DAYS = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const SYSTEM_INSTRUCTION = `You are an editor writing user-facing release notes for Overlord, a product that orchestrates AI coding agents.

Your audience is end users of the product (not the engineers who built it).

Rules:
- Group changes by theme using these section headings in this order: "Added", "Improved", "Fixed". Omit a section if it has no items.
- Each item is a short bullet starting with a bold leading phrase, e.g. "- **Faster ticket search** — results now stream as you type."
- Drop internal artifacts: ticket IDs, agent names, file paths, branch names, function names.
- Use plain product language. Avoid jargon and implementation details.
- If the input is sparse or unclear, prefer fewer, higher-quality bullets over padding.
- Return only valid JSON matching the requested shape. Do not include surrounding prose or markdown fences.`;

type DraftPayload = {
  title: string;
  summary: string;
  body_markdown: string;
  suggested_slug: string;
  used_feed_post_ids: string[];
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    body_markdown: { type: Type.STRING },
    suggested_slug: { type: Type.STRING },
    used_feed_post_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['title', 'summary', 'body_markdown', 'suggested_slug', 'used_feed_post_ids']
} as const;

function stripJsonFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fence ? fence[1] : text;
}

function parseJson(text: string): unknown | null {
  for (const candidate of [text, stripJsonFences(text)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }
  return null;
}

function defaultSlug(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function verifyAdmin(
  req: Request
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token' };
  }
  // Allow direct service-role calls (used for tests/admin tooling).
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true };
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: 'Invalid auth token' };
  }
  if ((data.user.email ?? '').toLowerCase() !== ADMIN_EMAIL) {
    return { ok: false, status: 403, error: 'Admin only' };
  }
  return { ok: true };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function formatFeedPostForPrompt(post: {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  tags: string[] | null;
  impact_level: string | null;
  created_at: string;
}): string {
  const tagPart = post.tags && post.tags.length > 0 ? ` [${post.tags.join(', ')}]` : '';
  const impactPart = post.impact_level ? ` (${post.impact_level})` : '';
  const summary = post.summary?.trim() || '';
  const body = post.body?.trim() || '';
  return [
    `### ${post.title}${impactPart}${tagPart}`,
    `id: ${post.id}`,
    `date: ${post.created_at}`,
    summary ? `summary: ${summary}` : '',
    body ? `body:\n${body}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function callGemini(prompt: string): Promise<DraftPayload | null> {
  if (!gemini) {
    console.error('[generate-changelog-draft] GEMINI_API_KEY not set');
    return null;
  }
  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 8192
      }
    });
    const text = response.text ?? '';
    if (!text) {
      console.error('[generate-changelog-draft] Empty Gemini response');
      return null;
    }
    const parsed = parseJson(text) as DraftPayload | null;
    return parsed;
  } catch (err) {
    console.error('[generate-changelog-draft] Gemini call failed', err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await verifyAdmin(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  let body: { sinceTimestamp?: string; until?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  // Resolve window start.
  let windowStart: string;
  if (body.sinceTimestamp) {
    windowStart = body.sinceTimestamp;
  } else {
    const { data: lastPublished } = await supabase
      .from('changelog_entries')
      .select('source_window_end')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastPublished?.source_window_end) {
      windowStart = lastPublished.source_window_end;
    } else {
      const fallback = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      windowStart = fallback.toISOString();
    }
  }
  const windowEnd = body.until ?? new Date().toISOString();

  const { data: feedPosts, error: feedError } = await supabase
    .from('feed_posts')
    .select('id, title, summary, body, tags, impact_level, created_at')
    .gt('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: true });

  if (feedError) {
    console.error('[generate-changelog-draft] feed_posts query failed', feedError);
    return jsonResponse({ error: 'Failed to load feed posts' }, 500);
  }

  if (!feedPosts || feedPosts.length === 0) {
    return jsonResponse({
      ok: true,
      empty: true,
      window_start: windowStart,
      window_end: windowEnd,
      draft: {
        title: 'No new changes',
        summary: 'No feed activity in the selected window.',
        body_markdown: '_No new changes since the last release._',
        suggested_slug: defaultSlug(),
        used_feed_post_ids: []
      }
    });
  }

  const formatted = feedPosts.map(formatFeedPostForPrompt).join('\n\n');
  const prompt = [
    `Window: ${windowStart} → ${windowEnd}`,
    `Feed posts available: ${feedPosts.length}`,
    '',
    'Draft a user-facing changelog entry that summarizes the notable changes below. Group items under Added / Improved / Fixed. Suggest a kebab-case slug (e.g. "2026-05-week-3" or a short theme).',
    '',
    '--- FEED POSTS ---',
    formatted
  ].join('\n');

  const draft = await callGemini(prompt);

  if (!draft) {
    return jsonResponse({ error: 'Gemini draft failed' }, 502);
  }

  return jsonResponse({
    ok: true,
    empty: false,
    window_start: windowStart,
    window_end: windowEnd,
    draft: {
      title: draft.title,
      summary: draft.summary,
      body_markdown: draft.body_markdown,
      suggested_slug: draft.suggested_slug || defaultSlug(),
      used_feed_post_ids: draft.used_feed_post_ids ?? feedPosts.map(p => p.id)
    }
  });
});
