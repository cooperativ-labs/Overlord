/// <reference lib="deno.ns" />
/**
 * generate-feed-post — Supabase Edge Function
 *
 * Synthesizes ticket events, change rationales, and ticket context into a
 * human-readable feed post using Google Gemini 2.5 Flash. Called after agent
 * delivery or review-status transitions.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

type FeedPostPayload = {
  title: string;
  body: string;
  tags: string[];
  impact_level: string;
  tradeoffs: Array<{ decision: string; alternatives_considered: string; rationale: string }>;
  human_actions: string[];
  files_touched: string[];
};

async function callGemini(prompt: string): Promise<FeedPostPayload | null> {
  if (!GEMINI_API_KEY) {
    console.error('[generate-feed-post] GEMINI_API_KEY not set');
    return null;
  }

  const url = new URL(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  );
  url.searchParams.set('key', GEMINI_API_KEY);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[generate-feed-post] Gemini API error:', response.status, errorText);
    return null;
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('[generate-feed-post] No text in Gemini response');
    return null;
  }

  try {
    const parsed = JSON.parse(text) as FeedPostPayload;
    // Basic validation
    if (!parsed.title || !parsed.body) {
      console.error('[generate-feed-post] Gemini response missing title or body');
      return null;
    }
    return {
      title: String(parsed.title).slice(0, 200),
      body: String(parsed.body).slice(0, 10_000),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 10) : [],
      impact_level: ['minor', 'notable', 'significant'].includes(parsed.impact_level)
        ? parsed.impact_level
        : 'notable',
      tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs.slice(0, 10) : [],
      human_actions: Array.isArray(parsed.human_actions)
        ? parsed.human_actions.map(String).slice(0, 20)
        : [],
      files_touched: Array.isArray(parsed.files_touched)
        ? parsed.files_touched.map(String).slice(0, 50)
        : []
    };
  } catch (err) {
    console.error('[generate-feed-post] Failed to parse Gemini JSON response:', err);
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

  return `You are writing a feed post for a developer dashboard that tracks AI agent work on code projects. Write for a developer audience — be concise, specific, and information-dense.

PROJECT: ${context.projectName}
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
  "body": "2-4 paragraphs in Markdown. Cover: what was done and why; any tradeoffs, compromises, or deviations from the objective; what the human should review or be aware of. Do NOT repeat the title in the body.",
  "tags": ["array of tags like: bugfix, refactor, new-feature, tradeoff, blocker-resolved, test, docs, config, dependency, performance, action-required"],
  "impact_level": "minor or notable or significant",
  "tradeoffs": [{"decision": "what was decided", "alternatives_considered": "what else was possible", "rationale": "why this choice"}],
  "human_actions": ["Any tasks, next steps, or follow-ups the human needs to do — e.g. run a migration, add an env variable, deploy a function, review a specific file, update a config, test a flow manually. Return an empty array if there is nothing for the human to do."],
  "files_touched": ["list/of/files.ts"]
}

IMPORTANT INSTRUCTIONS:
- Keep the body under 500 words.
- Surface tradeoffs prominently — they are the most valuable part. If there are no tradeoffs, return an empty array.
- ALWAYS check for human action items. If the agent's work requires ANY manual follow-up (running migrations, setting env vars, deploying, manual testing, config changes, dependency installs, etc.), these MUST appear in "human_actions". Also include items the agent explicitly flagged as needing human review or attention. This is critical — the human reads the feed to know what THEY need to do next.
- If the body mentions anything the human should do, it MUST also appear in "human_actions" as a discrete, actionable item.`;
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

    // Fetch change rationales
    const rationalesQuery = supabase
      .from('change_rationales')
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
        JSON.stringify({ ok: true, postId: existingPost.id, action: 'updated' }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
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
