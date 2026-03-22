/// <reference lib="deno.ns" />
/**
 * generate-feed-post — Supabase Edge Function
 *
 * Synthesizes ticket events, change rationales, and ticket context into a
 * human-readable feed post using Google Gemini 2.5 Flash. Called after agent
 * delivery or review-status transitions.
 */

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = 'gemini-2.5-flash';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const FEED_POST_SYSTEM_INSTRUCTION = `You write concise, high-signal feed posts for a developer dashboard tracking AI agent work on code projects.

Priorities:
- Be specific and technically accurate.
- Emphasize tradeoffs, risks, and reviewer-relevant context.
- Keep content concise and useful for humans scanning many updates. Use bullet points instead of long paragraphs.
- Return only valid JSON that matches the requested shape.
- Include human follow-up items ONLY for proactive tasks the human must do — e.g. creating an account, setting an API key, running a migration, deploying a function, adding an env variable, or configuring a service. Do NOT include instructions to manually test, verify, review code, or check that things work — those are implied.`;

type FeedPostPayload = {
  title: string;
  body: string;
  tags: string[];
  impact_level: string;
  tradeoffs: Array<{ decision: string; alternatives_considered: string; rationale: string }>;
  human_actions: string[];
  files_touched: string[];
};

function sanitizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeTradeoffs(value: unknown): FeedPostPayload['tradeoffs'] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;

      const tradeoff = item as Record<string, unknown>;
      const decision = String(tradeoff.decision ?? '').trim();
      const alternativesConsidered = String(tradeoff.alternatives_considered ?? '').trim();
      const rationale = String(tradeoff.rationale ?? '').trim();

      if (!decision || !alternativesConsidered || !rationale) return null;

      return {
        decision,
        alternatives_considered: alternativesConsidered,
        rationale
      };
    })
    .filter((tradeoff): tradeoff is FeedPostPayload['tradeoffs'][number] => tradeoff !== null)
    .slice(0, 10);
}

function normalizeFeedPostPayload(value: unknown): FeedPostPayload | null {
  if (!value || typeof value !== 'object') return null;

  const parsed = value as Record<string, unknown>;
  const title = String(parsed.title ?? '')
    .trim()
    .slice(0, 200);
  const body = String(parsed.body ?? '')
    .trim()
    .slice(0, 10_000);

  if (!title || !body) {
    console.error('[generate-feed-post] Gemini response missing title or body');
    return null;
  }

  const impactLevel = String(parsed.impact_level ?? '').trim();

  return {
    title,
    body,
    tags: sanitizeStringArray(parsed.tags, 10),
    impact_level: ['minor', 'notable', 'significant'].includes(impactLevel)
      ? impactLevel
      : 'notable',
    tradeoffs: sanitizeTradeoffs(parsed.tradeoffs),
    human_actions: sanitizeStringArray(parsed.human_actions, 20),
    files_touched: sanitizeStringArray(parsed.files_touched, 50)
  };
}

async function callGemini(prompt: string): Promise<FeedPostPayload | null> {
  if (!gemini) {
    console.error('[generate-feed-post] GEMINI_API_KEY not set');
    return null;
  }

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: FEED_POST_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 2048
      }
    });

    const text = response.text ?? '';
    if (!text) {
      console.error('[generate-feed-post] No text in Gemini response');
      return null;
    }

    return normalizeFeedPostPayload(JSON.parse(text));
  } catch (err) {
    console.error('[generate-feed-post] Gemini generation failed:', err);
    return null;
  }
}

function buildPrompt(context: {
  projectName: string;
  ticketTitle: string | null;
  ticketObjective: string | null;
  acceptanceCriteria: string | null;
  constraints: string | null;
  events: Array<{ created_at: string; event_type: string; summary: string | null }>;
  rationales: Array<{
    file_path: string;
    summary: string;
    why: string;
    impact: string;
  }>;
  existingPost?: { title: string; body: string } | null;
}): string {
  const eventLines = context.events
    .map(e => `[${e.created_at}] ${e.event_type}: ${e.summary ?? '(no summary)'}`)
    .join('\n');

  const rationaleLines = context.rationales
    .map(r => `- ${r.file_path}: ${r.summary} (why: ${r.why}, impact: ${r.impact})`)
    .join('\n');

  const appendSection = context.existingPost
    ? `\nPREVIOUS POST (merge new information into this, updating where needed):\nTitle: ${context.existingPost.title}\n${context.existingPost.body}\n`
    : '';

  return `PROJECT: ${context.projectName}
TICKET: ${context.ticketTitle ?? 'Untitled'} — ${context.ticketObjective ?? 'No objective'}
${context.acceptanceCriteria ? `ACCEPTANCE CRITERIA: ${context.acceptanceCriteria}` : ''}
${context.constraints ? `CONSTRAINTS: ${context.constraints}` : ''}
${appendSection}
CHRONOLOGICAL EVENTS (${context.events.length} total):
${eventLines || '(no events)'}

CODE CHANGES:
${rationaleLines || '(no code changes recorded)'}

Respond with a single JSON object:
{
  "title": "One-line action-oriented summary, max 80 characters",
  "body": "Concise Markdown summary using bullet points. Cover: what was done and why; any tradeoffs or deviations from the objective; what the human should be aware of. Do NOT repeat the title. Prefer bullet lists over paragraphs. Keep it scannable.",
  "tags": ["array of tags like: bugfix, refactor, new-feature, tradeoff, blocker-resolved, test, docs, config, dependency, performance, action-required"],
  "impact_level": "minor or notable or significant",
  "tradeoffs": [{"decision": "what was decided", "alternatives_considered": "what else was possible", "rationale": "why this choice"}],
  "human_actions": ["ONLY proactive tasks the human must do — e.g. create an account, set an API key, run a migration, add an env variable, deploy a function, configure a third-party service. Return an empty array if none."],
  "files_touched": ["list/of/files.ts"]
}

IMPORTANT INSTRUCTIONS:
- Keep the body under 300 words. Use bullet points, not paragraphs.
- Surface tradeoffs prominently — they are the most valuable part. If there are no tradeoffs, return an empty array.
- "human_actions" is ONLY for proactive tasks the human must perform — things like creating accounts, setting API keys, running migrations, adding env variables, deploying functions, or configuring external services. Do NOT include: testing the code, verifying behavior, reviewing files, checking that things work, or any other validation/QA tasks. Those are implied and clutter the feed. If there are no proactive tasks, return an empty array.
- Do not wrap the JSON in Markdown fences or any explanatory text.`;
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
    const { ticketId, sessionId, organizationId } = await req.json();

    if (!ticketId || !organizationId) {
      return new Response(JSON.stringify({ error: 'ticketId and organizationId are required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Check for existing post for this session (dedup / append)
    let existingPost: {
      id: string;
      title: string;
      body: string;
      source_event_ids: string[];
    } | null = null;
    if (sessionId) {
      const { data } = await supabase
        .from('feed_posts')
        .select('id, title, body, source_event_ids')
        .eq('session_id', sessionId)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      existingPost = data;
    }

    // Fetch ticket details
    const { data: ticket } = await supabase
      .from('tickets')
      .select('title, objective, acceptance_criteria, constraints, project_id')
      .eq('id', ticketId)
      .single();

    if (!ticket) {
      return new Response(JSON.stringify({ error: 'Ticket not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Fetch project name
    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', ticket.project_id)
      .single();

    // Fetch events for this session (or all recent events for ticket)
    const eventsQuery = supabase
      .from('ticket_events')
      .select('id, created_at, event_type, summary')
      .eq('ticket_id', ticketId)
      .neq('event_type', 'system')
      .order('created_at', { ascending: true })
      .limit(50);

    if (sessionId) {
      eventsQuery.eq('session_id', sessionId);
    }

    const { data: events } = await eventsQuery;

    // If appending, only get events not already in the post
    let filteredEvents = events ?? [];
    if (existingPost && existingPost.source_event_ids?.length) {
      const existingIds = new Set(existingPost.source_event_ids);
      filteredEvents = filteredEvents.filter(e => !existingIds.has(e.id));
    }

    // Skip if no new events to synthesize
    if (filteredEvents.length === 0 && !existingPost) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no events' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Fetch file changes
    const rationalesQuery = supabase
      .from('file_changes')
      .select('file_path, summary, why, impact')
      .eq('ticket_id', ticketId)
      .limit(30);

    if (sessionId) {
      rationalesQuery.eq('session_id', sessionId);
    }

    const { data: rationales } = await rationalesQuery;

    // Fetch agent type from session
    let agentType: string | null = null;
    if (sessionId) {
      const { data: session } = await supabase
        .from('agent_sessions')
        .select('agent_identifier')
        .eq('id', sessionId)
        .single();
      agentType = session?.agent_identifier ?? null;
    }

    // Build prompt and call Gemini
    const prompt = buildPrompt({
      projectName: project?.name ?? 'Unknown Project',
      ticketTitle: ticket.title,
      ticketObjective: ticket.objective,
      acceptanceCriteria: ticket.acceptance_criteria,
      constraints: ticket.constraints,
      events: filteredEvents,
      rationales: rationales ?? [],
      existingPost: existingPost ? { title: existingPost.title, body: existingPost.body } : null
    });

    const generated = await callGemini(prompt);

    if (!generated) {
      return new Response(JSON.stringify({ ok: false, error: 'Gemini generation failed' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Compute event window
    const allEvents = events ?? [];
    const eventIds = allEvents.map(e => e.id);
    const timestamps = allEvents.map(e => e.created_at).sort();
    const windowStart = timestamps[0] ?? new Date().toISOString();
    const windowEnd = timestamps[timestamps.length - 1] ?? new Date().toISOString();

    if (existingPost) {
      // Append: update existing post
      const mergedEventIds = [...new Set([...(existingPost.source_event_ids ?? []), ...eventIds])];

      const { error: updateError } = await supabase
        .from('feed_posts')
        .update({
          title: generated.title,
          body: generated.body,
          tags: generated.tags,
          impact_level: generated.impact_level,
          tradeoffs: generated.tradeoffs,
          human_actions: generated.human_actions,
          files_touched: generated.files_touched,
          source_event_ids: mergedEventIds,
          source_window_end: windowEnd,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingPost.id);

      if (updateError) {
        console.error('[generate-feed-post] update error:', updateError);
        return new Response(JSON.stringify({ ok: false, error: updateError.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          postId: existingPost.id,
          action: 'updated'
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    } else {
      // Create new post
      const { data: newPost, error: insertError } = await supabase
        .from('feed_posts')
        .insert({
          organization_id: organizationId,
          project_id: ticket.project_id,
          ticket_id: ticketId,
          session_id: sessionId ?? null,
          agent_type: agentType,
          title: generated.title,
          body: generated.body,
          tags: generated.tags,
          impact_level: generated.impact_level,
          files_touched: generated.files_touched,
          tradeoffs: generated.tradeoffs,
          human_actions: generated.human_actions,
          source_event_ids: eventIds,
          source_window_start: windowStart,
          source_window_end: windowEnd
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[generate-feed-post] insert error:', insertError);
        return new Response(JSON.stringify({ ok: false, error: insertError.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ ok: true, postId: newPost?.id, action: 'created' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  } catch (err) {
    console.error('[generate-feed-post] unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', details: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
});
