/// <reference lib="deno.ns" />
/**
 * generate-feed-post — Supabase Edge Function
 *
 * Synthesizes ticket events, change rationales, and ticket context into a
 * human-readable feed post using Google Gemini 2.5 Flash. Called after agent
 * delivery or review-status transitions.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

import {
  CandidateAction,
  deriveCandidateActions,
  formatCandidatesForPrompt,
  RepoOperationsProfile
} from './operations-rules.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = 'gemini-3-flash-preview';

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
- Include human follow-up items ONLY for proactive tasks the human must do — e.g. creating an account, setting an API key, running a migration, deploying a function, adding an env variable, or configuring a service. Do NOT include instructions to manually test, verify, review code, or check that things work — those are implied.
- When the prompt includes a CANDIDATE FOLLOW-UP ACTIONS block, treat those as deterministically-derived seeds for human_actions: include the relevant ones (rephrasing freely), drop any that are clearly not applicable to the actual changes, and only add new actions if the candidate list is missing something the human must proactively do.`;

type GeneratedObjectiveSection = {
  objective_id: string;
  title?: string;
  takeaway?: string;
  body: string | string[];
  action_required: string[];
  tradeoffs: Array<{ decision: string; alternatives_considered: string; rationale: string }>;
};

type FeedPostPayload = {
  title: string;
  summary: string;
  body: string;
  tags: string[];
  impact_level: string;
  tradeoffs: Array<{ decision: string; alternatives_considered: string; rationale: string }>;
  human_actions: string[];
  files_touched: string[];
  tickets_created: Array<{
    id: string;
    reference?: string | null;
    sequence: number;
    title: string;
  }>;
  objective_sections: GeneratedObjectiveSection[];
};

type ObjectiveSection = {
  id: string;
  objective_id: string;
  index: number;
  title: string;
  state: string;
  position: number;
  time: string | null;
  duration: string | null;
  events: number;
  takeaway: string;
  body: string;
  file_changes: Array<{
    path: string;
    status: string;
    additions: number | null;
    deletions: number | null;
    note?: string;
  }>;
  action_required: string[];
  tradeoffs: Array<{ decision: string; alternatives_considered: string; rationale: string }>;
  event_ids: string[];
  updated_at: string | null;
};

type StructuredFileChange = ObjectiveSection['file_changes'][number];

type FeedPostContext = {
  projectName: string;
  ticketTitle: string | null;
  ticketObjective: string | null;
  acceptanceCriteria: string | null;
  constraints: string | null;
  feedPostInstructions: string | null;
  objectives: Array<{
    id: string;
    objective: string;
    state: string;
    created_at: string;
    updated_at: string;
  }>;
  events: Array<{
    id: string;
    created_at: string;
    event_type: string;
    summary: string | null;
    objective_id: string | null;
    session_id: string | null;
  }>;
  rationales: Array<{
    file_path: string;
    summary: string;
    why: string;
    impact: string;
    change_kind: string | null;
    hunks: unknown;
    objective_id: string | null;
  }>;
  spawnedTickets: Array<{
    id: string;
    ticket_id: string | null;
    title: string | null;
    ticket_sequence: number;
    delegate: string | null;
  }>;
  existingPost?: { title: string; body: string; summary: string } | null;
  candidateActions?: CandidateAction[];
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

function sanitizeTicketsCreated(value: unknown): FeedPostPayload['tickets_created'] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const ticket = item as Record<string, unknown>;
      const id = String(ticket.id ?? '').trim();
      const sequence = typeof ticket.sequence === 'number' ? ticket.sequence : 0;
      const title = String(ticket.title ?? '').trim();
      if (!id || !title) return null;
      return { id, sequence, title };
    })
    .filter((t): t is FeedPostPayload['tickets_created'][number] => t !== null)
    .slice(0, 20);
}

function sanitizeObjectiveSections(value: unknown): FeedPostPayload['objective_sections'] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const section = item as Record<string, unknown>;
      const objectiveId = String(section.objective_id ?? '').trim();
      const rawBody = Array.isArray(section.body)
        ? section.body.map(item => String(item).trim()).filter(Boolean)
        : String(section.body ?? '').trim();
      const body = Array.isArray(rawBody) ? rawBody.slice(0, 8) : rawBody.slice(0, 3_000);
      if (!objectiveId || !body) return null;
      const title = String(section.title ?? '')
        .trim()
        .slice(0, 160);
      const takeaway = String(section.takeaway ?? '')
        .trim()
        .slice(0, 1_000);
      return {
        objective_id: objectiveId,
        ...(title ? { title } : {}),
        ...(takeaway ? { takeaway } : {}),
        body,
        action_required: sanitizeStringArray(section.action_required, 20),
        tradeoffs: Array.isArray(section.tradeoffs)
          ? section.tradeoffs
              .map(item => {
                if (!item || typeof item !== 'object') return null;
                const tradeoff = item as Record<string, unknown>;
                const decision = String(tradeoff.decision ?? '').trim();
                const alternatives = String(
                  tradeoff.alternatives_considered ?? tradeoff.alternatives ?? ''
                ).trim();
                const rationale = String(tradeoff.rationale ?? '').trim();
                if (!decision || !rationale) return null;
                return {
                  decision,
                  alternatives_considered: alternatives,
                  rationale
                };
              })
              .filter(
                (
                  tradeoff
                ): tradeoff is {
                  decision: string;
                  alternatives_considered: string;
                  rationale: string;
                } => tradeoff !== null
              )
              .slice(0, 10)
          : []
      };
    })
    .filter((section): section is FeedPostPayload['objective_sections'][number] => section !== null)
    .slice(0, 25);
}

function sanitizeOptionalInstruction(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 4_000) : null;
}

function normalizeFeedPostPayload(value: unknown): FeedPostPayload | null {
  if (!value || typeof value !== 'object') return null;

  const parsed = value as Record<string, unknown>;
  const title = String(parsed.title ?? '')
    .trim()
    .slice(0, 200);
  const summary = String(parsed.summary ?? parsed.body ?? '')
    .trim()
    .slice(0, 4_000);
  const body = String(parsed.body ?? '')
    .trim()
    .slice(0, 10_000);
  const objectiveSections = sanitizeObjectiveSections(parsed.objective_sections);

  if (!title || (!summary && !body && objectiveSections.length === 0)) {
    console.error('[generate-feed-post] Gemini response missing title or content');
    return null;
  }

  const impactLevel = String(parsed.impact_level ?? '').trim();

  return {
    title,
    summary,
    body,
    tags: sanitizeStringArray(parsed.tags, 10),
    impact_level: ['minor', 'notable', 'significant'].includes(impactLevel)
      ? impactLevel
      : 'notable',
    tradeoffs: sanitizeTradeoffs(parsed.tradeoffs),
    human_actions: sanitizeStringArray(parsed.human_actions, 20),
    files_touched: sanitizeStringArray(parsed.files_touched, 50),
    tickets_created: sanitizeTicketsCreated(parsed.tickets_created),
    objective_sections: objectiveSections
  };
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractJsonObject(text: string): string {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return text.trim();
  }

  return text.slice(firstBrace, lastBrace + 1).trim();
}

function repairJsonText(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3');
}

type ParseAttempt = { strategy: string; error: string };

function parseGeminiJson(text: string): {
  value: unknown | null;
  strategy: string | null;
  attempts: ParseAttempt[];
} {
  const candidates: Array<{ strategy: string; text: string }> = [
    { strategy: 'raw', text },
    { strategy: 'strip-fences', text: stripJsonFences(text) },
    { strategy: 'extract-object', text: extractJsonObject(text) },
    {
      strategy: 'repair-stripped-extracted',
      text: repairJsonText(stripJsonFences(extractJsonObject(text)))
    },
    { strategy: 'repair-raw', text: repairJsonText(text) }
  ];

  const attempts: ParseAttempt[] = [];
  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate.text), strategy: candidate.strategy, attempts };
    } catch (err) {
      attempts.push({
        strategy: candidate.strategy,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return { value: null, strategy: null, attempts };
}

function truncate(text: string, max = 2_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[${text.length - max} more chars]`;
}

const FEED_POST_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    body: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    impact_level: { type: Type.STRING, enum: ['minor', 'notable', 'significant'] },
    tradeoffs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING },
          alternatives_considered: { type: Type.STRING },
          rationale: { type: Type.STRING }
        },
        required: ['decision', 'alternatives_considered', 'rationale']
      }
    },
    human_actions: { type: Type.ARRAY, items: { type: Type.STRING } },
    files_touched: { type: Type.ARRAY, items: { type: Type.STRING } },
    tickets_created: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          sequence: { type: Type.NUMBER },
          title: { type: Type.STRING }
        },
        required: ['id', 'sequence', 'title']
      }
    },
    objective_sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          objective_id: { type: Type.STRING },
          title: { type: Type.STRING },
          takeaway: { type: Type.STRING },
          body: { type: Type.ARRAY, items: { type: Type.STRING } },
          action_required: { type: Type.ARRAY, items: { type: Type.STRING } },
          tradeoffs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                decision: { type: Type.STRING },
                alternatives_considered: { type: Type.STRING },
                rationale: { type: Type.STRING }
              },
              required: ['decision', 'alternatives_considered', 'rationale']
            }
          }
        },
        required: ['objective_id', 'body']
      }
    }
  },
  required: ['title', 'summary', 'tags', 'impact_level', 'objective_sections']
} as const;

async function callGemini(prompt: string): Promise<FeedPostPayload | null> {
  if (!gemini) {
    console.error('[generate-feed-post] GEMINI_API_KEY not set');
    return null;
  }

  const startedAt = Date.now();
  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: FEED_POST_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: FEED_POST_RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 8192
      }
    });

    const elapsedMs = Date.now() - startedAt;
    const text = response.text ?? '';
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason ?? null;
    const safetyRatings = candidate?.safetyRatings ?? null;
    const promptFeedback = response.promptFeedback ?? null;
    const usage = response.usageMetadata ?? null;

    if (!text) {
      console.error('[generate-feed-post] Empty Gemini response', {
        model: GEMINI_MODEL,
        elapsedMs,
        finishReason,
        promptFeedback,
        safetyRatings,
        usage
      });
      return null;
    }

    const { value: parsed, strategy, attempts } = parseGeminiJson(text);
    if (!parsed) {
      console.error('[generate-feed-post] Gemini response could not be parsed as JSON', {
        model: GEMINI_MODEL,
        elapsedMs,
        finishReason,
        textLength: text.length,
        textPreview: truncate(text),
        attempts,
        usage
      });
      return null;
    }

    if (strategy && strategy !== 'raw') {
      console.warn('[generate-feed-post] Parsed Gemini JSON via fallback strategy', {
        strategy,
        textLength: text.length,
        finishReason
      });
    }

    const normalized = normalizeFeedPostPayload(parsed);
    if (!normalized) {
      console.error('[generate-feed-post] Gemini JSON parsed but failed validation', {
        model: GEMINI_MODEL,
        finishReason,
        textLength: text.length,
        textPreview: truncate(text)
      });
      return null;
    }

    console.log('[generate-feed-post] Gemini synthesis complete', {
      model: GEMINI_MODEL,
      elapsedMs,
      finishReason,
      textLength: text.length,
      objectiveSections: normalized.objective_sections.length,
      usage
    });

    return normalized;
  } catch (err) {
    console.error('[generate-feed-post] Gemini generation failed', {
      model: GEMINI_MODEL,
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
    });
    return null;
  }
}

function buildFallbackFeedPost(context: FeedPostContext): FeedPostPayload {
  const eventCount = context.events.length;
  const rationaleCount = context.rationales.length;
  const spawnedCount = context.spawnedTickets.length;
  const primaryObjective = context.ticketObjective ?? context.ticketTitle ?? 'ticket';
  const objectiveSummary =
    context.ticketObjective?.trim() || context.ticketTitle?.trim() || 'the ticket';
  const changedFiles = [
    ...new Set(context.rationales.map(r => r.file_path.trim()).filter(Boolean))
  ].slice(0, 8);
  const completedObjective = context.events.find(
    e => e.event_type === 'update' && e.summary
  )?.summary;
  const summary = [
    `- ${completedObjective ?? `Updated ${objectiveSummary}`}.`,
    `- ${eventCount} ticket event${eventCount === 1 ? '' : 's'} and ${rationaleCount} file change${rationaleCount === 1 ? '' : 's'} are represented in this rollup.`,
    spawnedCount > 0
      ? `- ${spawnedCount} spawned ticket${spawnedCount === 1 ? '' : 's'} were linked to this work.`
      : '- No follow-up tickets were spawned.',
    context.existingPost
      ? '- Gemini was unavailable, so this post was refreshed with a deterministic summary.'
      : '- Gemini was unavailable, so this post was created with a deterministic summary.'
  ].join('\n');

  return {
    title: `Progress update: ${primaryObjective.slice(0, 60)}`,
    summary,
    body: summary,
    tags: ['fallback', 'bugfix', 'feed'],
    impact_level: eventCount > 0 || rationaleCount > 0 ? 'notable' : 'minor',
    tradeoffs: [],
    human_actions: [],
    files_touched: changedFiles,
    tickets_created: context.spawnedTickets.map(t => ({
      id: t.id,
      reference: t.ticket_id,
      sequence: t.ticket_sequence,
      title: t.title ?? 'Untitled'
    })),
    objective_sections: context.objectives.map(objective => {
      const objectiveEvents = context.events.filter(event => event.objective_id === objective.id);
      const objectiveFiles = context.rationales.filter(
        rationale => rationale.objective_id === objective.id
      );
      return {
        objective_id: objective.id,
        title: objective.objective.slice(0, 120),
        takeaway:
          objectiveEvents.find(event => event.summary)?.summary ??
          `Recorded ${objectiveEvents.length} event${objectiveEvents.length === 1 ? '' : 's'} for this objective.`,
        body: [
          objectiveEvents.length > 0
            ? `- Recorded ${objectiveEvents.length} event${objectiveEvents.length === 1 ? '' : 's'} for this objective.`
            : '- No objective-specific events were recorded.',
          objectiveFiles.length > 0
            ? `- Captured file changes for ${objectiveFiles.length} path${objectiveFiles.length === 1 ? '' : 's'}.`
            : '- No objective-specific file changes were recorded.'
        ].join('\n'),
        action_required: [],
        tradeoffs: []
      };
    })
  };
}

function buildPrompt(context: FeedPostContext): string {
  const objectiveLines = context.objectives
    .map(
      (objective, index) =>
        `${index + 1}. ${objective.id} [${objective.state}]: ${objective.objective}`
    )
    .join('\n');

  const eventLines = context.events
    .map(
      e =>
        `[${e.created_at}] ${e.event_type}${e.objective_id ? ` objective=${e.objective_id}` : ' ticket-wide'}: ${e.summary ?? '(no summary)'}`
    )
    .join('\n');

  const rationaleLines = context.rationales
    .map(
      r =>
        `- ${r.objective_id ? `objective=${r.objective_id}` : 'ticket-wide'} ${r.file_path}: ${r.summary} (why: ${r.why}, impact: ${r.impact})`
    )
    .join('\n');

  const spawnedLines = context.spawnedTickets
    .map(
      t =>
        `- ${t.ticket_id ?? t.ticket_sequence}: ${t.title ?? 'Untitled'}${t.delegate ? ` (delegate: ${t.delegate})` : ''}`
    )
    .join('\n');

  const candidatesSection =
    context.candidateActions && context.candidateActions.length > 0
      ? `\n${formatCandidatesForPrompt(context.candidateActions)}\n`
      : '';

  const appendSection = context.existingPost
    ? `\nPREVIOUS POST (merge new information into this, updating where needed):\nTitle: ${context.existingPost.title}\n${context.existingPost.body}\n`
    : '';
  const feedInstructionsSection = context.feedPostInstructions
    ? `\nPROJECT-USER FEED INSTRUCTIONS:\n${context.feedPostInstructions}\n`
    : '';

  return `PROJECT: ${context.projectName}
TICKET: ${context.ticketTitle ?? 'Untitled'} — ${context.ticketObjective ?? 'No objective'}
${context.acceptanceCriteria ? `ACCEPTANCE CRITERIA: ${context.acceptanceCriteria}` : ''}
${context.constraints ? `CONSTRAINTS: ${context.constraints}` : ''}
${feedInstructionsSection}
${candidatesSection}
${appendSection}
CHRONOLOGICAL EVENTS (${context.events.length} total):
${eventLines || '(no events)'}

OBJECTIVES (${context.objectives.length} total, ascending):
${objectiveLines || '(no objectives)'}

CODE CHANGES:
${rationaleLines || '(no code changes recorded)'}

TICKETS CREATED DURING THIS SESSION:
${spawnedLines || '(none)'}

Respond with a single JSON object:
{
  "title": "One-line action-oriented summary, max 80 characters",
  "summary": "Concise mutable ticket-level Markdown summary using bullet points.",
  "body": "Legacy compatibility field. You may repeat summary here; server code renders the final body.",
  "tags": ["array of tags like: bugfix, refactor, new-feature, tradeoff, blocker-resolved, test, docs, config, dependency, performance, action-required"],
  "impact_level": "minor or notable or significant",
  "tradeoffs": [{"decision": "what was decided", "alternatives_considered": "what else was possible", "rationale": "why this choice"}],
  "human_actions": ["ONLY proactive tasks the human must do — e.g. create an account, set an API key, run a migration, add an env variable, deploy a function, repackage or recompile an app, configure a third-party service. Return an empty array if none."],
      "files_touched": ["list/of/files.ts"],
      "tickets_created": [{"id": "uuid", "sequence": 123, "title": "Ticket title"}],
  "objective_sections": [{
    "objective_id": "uuid from OBJECTIVES",
    "title": "Short objective row title",
    "takeaway": "One-sentence scan summary for this objective row",
    "body": ["Detailed bullet for the drawer"],
    "action_required": ["Objective-scoped proactive human task"],
    "tradeoffs": [{"decision": "what was decided", "alternatives_considered": "what else was possible", "rationale": "why this choice"}]
  }]
}

IMPORTANT INSTRUCTIONS:
- Keep summary and each objective section under 300 words. Use bullet points, not paragraphs.
- Return one objective_sections entry for each meaningful objective listed above, keyed by objective_id. Do not invent objective IDs.
- Put human action items and tradeoffs under the objective they belong to. Also include them in the top-level human_actions/tradeoffs arrays for compatibility.
- Surface tradeoffs prominently — they are the most valuable part. Be clear about which direction was chosen and which was not. If there are no tradeoffs, return an empty array.
- Follow any PROJECT-USER FEED INSTRUCTIONS when they are provided, unless they conflict with the required JSON shape or the source facts.
- "human_actions" is ONLY for proactive tasks the human must perform — things like creating accounts, setting API keys, running migrations, adding env variables, deploying functions, or configuring external services. Do NOT include: testing the code, verifying behavior, reviewing files, checking that things work, or any other validation/QA tasks. Those are implied and clutter the feed. If there are no proactive tasks, return an empty array.
- "tickets_created" should list any tickets that were spawned/created during this session. Return an empty array if none.
- Do not wrap the JSON in Markdown fences or any explanatory text.`;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 100): string[] {
  return [
    ...new Set(values.map(value => value?.trim()).filter((value): value is string => !!value))
  ].slice(0, limit);
}

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return null;
  }
}

function normalizeFileChangeStatus(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'added' || normalized === 'created') return 'added';
  if (normalized === 'deleted' || normalized === 'removed') return 'deleted';
  if (normalized === 'renamed' || normalized === 'moved') return 'renamed';
  return 'modified';
}

function normalizeObjectiveState(value: string): string {
  if (value === 'complete') return 'completed';
  if (value === 'blocked') return 'abandoned';
  return value;
}

function buildStructuredFileChanges(
  rationales: FeedPostContext['rationales'],
  orphan = false
): StructuredFileChange[] {
  return rationales.map(rationale => ({
    path: rationale.file_path,
    status: normalizeFileChangeStatus(rationale.change_kind),
    additions: null,
    deletions: null,
    ...(orphan ? { note: 'Not linked to an objective' } : {})
  }));
}

function buildObjectiveSections(
  context: FeedPostContext,
  generatedSections: FeedPostPayload['objective_sections']
): ObjectiveSection[] {
  const generatedByObjectiveId = new Map(
    generatedSections.map(section => [section.objective_id, section])
  );

  return context.objectives.map((objective, index) => {
    const generated = generatedByObjectiveId.get(objective.id);
    const objectiveEvents = context.events.filter(event => event.objective_id === objective.id);
    const objectiveRationales = context.rationales.filter(
      rationale => rationale.objective_id === objective.id
    );
    const latestEventAt = objectiveEvents
      .map(event => event.created_at)
      .sort()
      .at(-1);
    const body = generated?.body
      ? Array.isArray(generated.body)
        ? generated.body.map(item => `- ${item.replace(/^[-*]\s*/, '')}`).join('\n')
        : generated.body
      : [
          objectiveEvents.length > 0
            ? `- Recorded ${objectiveEvents.length} event${objectiveEvents.length === 1 ? '' : 's'} for this objective.`
            : '- No objective-specific events were recorded.',
          objectiveRationales.length > 0
            ? `- Captured ${objectiveRationales.length} file change${objectiveRationales.length === 1 ? '' : 's'} for this objective.`
            : '- No objective-specific file changes were recorded.'
        ].join('\n');

    return {
      id: objective.id,
      objective_id: objective.id,
      index: index + 1,
      title: generated?.title ?? objective.objective.slice(0, 120),
      state: normalizeObjectiveState(objective.state),
      position: index,
      time: formatTime(objective.created_at),
      duration: objective.state === 'executing' ? 'ongoing' : null,
      events: objectiveEvents.length,
      takeaway:
        generated?.takeaway ??
        body
          .replace(/^[-*]\s*/, '')
          .split('\n')[0]
          ?.slice(0, 500) ??
        '',
      body,
      file_changes: buildStructuredFileChanges(objectiveRationales),
      action_required: generated?.action_required ?? [],
      tradeoffs: generated?.tradeoffs ?? [],
      event_ids: uniqueStrings(
        objectiveEvents.map(event => event.id),
        100
      ),
      updated_at: latestEventAt ?? objective.updated_at ?? objective.created_at ?? null
    };
  });
}

function renderFeedBody(
  summary: string,
  sections: ObjectiveSection[],
  orphanFileChanges: StructuredFileChange[]
): string {
  const chunks: string[] = [];
  const cleanedSummary = summary.trim();
  if (cleanedSummary) {
    chunks.push(`## Summary\n${cleanedSummary}`);
  }

  if (orphanFileChanges.length > 0) {
    chunks.push(
      ['## Ticket-wide changes', ...orphanFileChanges.map(change => `- ${change.path}`)].join('\n')
    );
  }

  for (const section of sections) {
    const heading = `## Objective ${section.index}: ${section.title}`;
    const files =
      section.file_changes.length > 0
        ? ['', 'Files:', ...section.file_changes.map(change => `- ${change.path}`)].join('\n')
        : '';
    chunks.push(`${heading}\n${section.body.trim()}${files}`);
  }

  return chunks.join('\n\n').trim();
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

    // Feed posts are ticket-level rollups: resolve the canonical row by ticket_id.
    let existingPost: {
      id: string;
      title: string;
      body: string;
      summary: string;
      source_event_ids: string[];
      source_session_ids: string[];
    } | null = null;

    const { data: existingPostRow } = await supabase
      .from('feed_posts')
      .select('id, title, body, summary, source_event_ids, source_session_ids')
      .eq('ticket_id', ticketId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    existingPost = existingPostRow;

    // Fetch ticket details
    const { data: ticket } = await supabase
      .from('tickets')
      .select('title, acceptance_criteria, constraints, project_id, created_by')
      .eq('id', ticketId)
      .single();

    if (!ticket) {
      return new Response(JSON.stringify({ error: 'Ticket not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (!ticket.project_id) {
      return new Response(JSON.stringify({ ok: true, skipped: 'personal_ticket' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Fetch all objectives for the ticket; the rendered feed body presents them as an ascending timeline.
    const { data: objectives } = await supabase
      .from('objectives')
      .select('id, objective, state, created_at, updated_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    // Fetch the most recent executed objective for the rollup's lightweight latest pointer.
    const { data: executedObjective } = await supabase
      .from('objectives')
      .select('id, objective')
      .eq('ticket_id', ticketId)
      .in('state', ['executing', 'complete'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fallback to latest objective if no executed one found
    const latestObjective =
      executedObjective ??
      (
        await supabase
          .from('objectives')
          .select('id, objective')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;

    // Fetch project name
    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', ticket.project_id)
      .single();

    const { data: projectUserPreferences } = await supabase
      .from('project_user')
      .select('preferences')
      .eq('project_id', ticket.project_id)
      .eq('user_id', ticket.created_by)
      .maybeSingle();

    const feedPostInstructions = sanitizeOptionalInstruction(
      (projectUserPreferences?.preferences as Record<string, unknown> | null)
        ?.feed_post_instructions
    );

    // Fetch ticket-wide events so every regeneration rebuilds the canonical rollup from source facts.
    const eventsQuery = supabase
      .from('ticket_events')
      .select('id, created_at, event_type, summary, objective_id, session_id')
      .eq('ticket_id', ticketId)
      .neq('event_type', 'system')
      .order('created_at', { ascending: true })
      .limit(100);

    const { data: events } = await eventsQuery;

    // Skip if there is nothing to synthesize.
    if ((events ?? []).length === 0 && !existingPost) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no events' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Fetch file changes
    const { data: rationales } = await supabase
      .from('file_changes')
      .select('file_path, summary, why, impact, change_kind, hunks, objective_id')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .limit(100);

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

    // Fetch tickets spawned during this session (recorded via protocol.spawn
    // with parentSessionKey pointing back to this session).
    let spawnedTickets: Array<{
      id: string;
      ticket_id: string | null;
      title: string | null;
      ticket_sequence: number;
      delegate: string | null;
    }> = [];
    if (sessionId) {
      // Find spawn events on this session that reference spawned_ticket_id
      const { data: spawnEvents } = await supabase
        .from('ticket_events')
        .select('payload')
        .eq('session_id', sessionId)
        .eq('ticket_id', ticketId)
        .limit(50);

      const spawnedIds = (spawnEvents ?? [])
        .map(e => {
          const p = e.payload as Record<string, unknown> | null;
          return p?.spawned_ticket_id as string | undefined;
        })
        .filter((id): id is string => !!id);

      if (spawnedIds.length > 0) {
        const { data: tickets } = await supabase
          .from('tickets')
          .select('id, ticket_id, title, ticket_sequence, delegate')
          .in('id', spawnedIds);
        spawnedTickets = tickets ?? [];
      }
    }

    // Load the project's compact repo operations profile and derive deterministic
    // follow-up action candidates from the changed paths. The profile is small
    // (≤ ~4 KB) and only the resulting candidate lines (~1.5 KB worst case) flow
    // into the prompt — the raw file tree never does.
    let candidateActions: CandidateAction[] = [];
    try {
      const { data: projectRow } = await supabase
        .from('projects')
        .select('operations_profile')
        .eq('id', ticket.project_id)
        .maybeSingle();

      const profile = (projectRow?.operations_profile ?? null) as RepoOperationsProfile | null;
      const changedPaths = (rationales ?? []).map(r => r.file_path).filter(Boolean);
      candidateActions = deriveCandidateActions(profile, changedPaths);
    } catch (err) {
      console.warn('[generate-feed-post] candidate derivation failed:', err);
    }

    // Build the synthesis context once so Gemini and the fallback share the same inputs.
    const feedContext: FeedPostContext = {
      projectName: project?.name ?? 'Unknown Project',
      ticketTitle: ticket.title,
      ticketObjective: latestObjective?.objective ?? null,
      acceptanceCriteria: ticket.acceptance_criteria,
      constraints: ticket.constraints,
      feedPostInstructions,
      objectives: objectives ?? [],
      events: events ?? [],
      rationales: rationales ?? [],
      spawnedTickets,
      existingPost: existingPost
        ? { title: existingPost.title, body: existingPost.body, summary: existingPost.summary }
        : null,
      candidateActions
    };

    const prompt = buildPrompt(feedContext);

    // Fall back to a deterministic post so feed visibility does not depend on Gemini availability.
    const generated = (await callGemini(prompt)) ?? buildFallbackFeedPost(feedContext);
    const objectiveSections = buildObjectiveSections(feedContext, generated.objective_sections);
    const summary = generated.summary || generated.body;
    const orphanFileChanges = buildStructuredFileChanges(
      (rationales ?? []).filter(rationale => !rationale.objective_id),
      true
    );
    const renderedBody = renderFeedBody(summary, objectiveSections, orphanFileChanges);
    const filesTouched =
      generated.files_touched.length > 0
        ? generated.files_touched
        : uniqueStrings(
            (rationales ?? []).map(rationale => rationale.file_path),
            50
          );
    const pendingActions =
      objectiveSections.reduce((count, section) => count + section.action_required.length, 0) ||
      generated.human_actions.length;

    // Compute event window
    const allEvents = events ?? [];
    const eventIds = allEvents.map(e => e.id);
    const sourceSessionIds = uniqueStrings(
      [...allEvents.map(e => e.session_id), sessionId ?? null],
      100
    );
    const timestamps = allEvents.map(e => e.created_at).sort();
    const windowStart = timestamps[0] ?? new Date().toISOString();
    const windowEnd = timestamps[timestamps.length - 1] ?? new Date().toISOString();

    // Build structured tickets_created from source data (not Gemini output)
    const ticketsCreatedPayload = spawnedTickets.map(t => ({
      id: t.id,
      reference: t.ticket_id,
      sequence: t.ticket_sequence,
      title: t.title ?? 'Untitled'
    }));

    if (existingPost) {
      // Append: update existing post
      const mergedEventIds = [...new Set([...(existingPost.source_event_ids ?? []), ...eventIds])];

      const { error: updateError } = await supabase
        .from('feed_posts')
        .update({
          session_id: sessionId ?? null,
          title: generated.title,
          summary,
          body: renderedBody,
          tags: generated.tags,
          impact_level: generated.impact_level,
          tradeoffs: generated.tradeoffs,
          human_actions: generated.human_actions,
          files_touched: filesTouched,
          tickets_created: ticketsCreatedPayload,
          objective_id: latestObjective?.id ?? null,
          objective_sections: objectiveSections,
          orphan_file_changes: orphanFileChanges,
          total_events: allEvents.length,
          total_files: filesTouched.length,
          pending_actions: pendingActions,
          source_event_ids: mergedEventIds,
          source_session_ids: uniqueStrings([
            ...(existingPost.source_session_ids ?? []),
            ...sourceSessionIds
          ]),
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
          objective_id: latestObjective?.id ?? null,
          agent_type: agentType,
          title: generated.title,
          summary,
          body: renderedBody,
          tags: generated.tags,
          impact_level: generated.impact_level,
          files_touched: filesTouched,
          tradeoffs: generated.tradeoffs,
          human_actions: generated.human_actions,
          tickets_created: ticketsCreatedPayload,
          objective_sections: objectiveSections,
          orphan_file_changes: orphanFileChanges,
          total_events: allEvents.length,
          total_files: filesTouched.length,
          pending_actions: pendingActions,
          source_event_ids: eventIds,
          source_session_ids: sourceSessionIds,
          source_window_start: windowStart,
          source_window_end: windowEnd,
          created_by: ticket.created_by ?? null
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
