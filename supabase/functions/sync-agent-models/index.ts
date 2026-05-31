/// <reference lib="deno.ns" />
/**
 * sync-agent-models — Supabase Edge Function
 *
 * Queries provider APIs (Anthropic, OpenAI, Cursor) for available
 * models and upserts them into the `agent_models` table. Intended to be called
 * on a cron schedule (every 12 hours).
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const CURSOR_AGENTS_API_KEY = Deno.env.get('CURSOR_AGENTS_API_KEY') ?? '';
const CURSOR_API_KEY = Deno.env.get('CURSOR_API_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

type AgentModelRow = {
  agent_type: string;
  model_id: string;
  display_name: string;
  thinking_options: string[];
  capabilities: Record<string, unknown>;
  is_recommended: boolean;
  sort_order: number;
  updated_at: string;
};

const CLAUDE_LATEST_MAJOR_PATTERN = /(opus|sonnet|haiku)-4([-.]|$)/;
const OPENAI_LATEST_MAJOR_PREFIXES = ['gpt-5', 'codex-5'];

function buildCapabilities(compatibleAgents: string[]): Record<string, unknown> {
  return {
    compatible_agents: compatibleAgents
  };
}

function resolveCursorApiKey(): string {
  return CURSOR_AGENTS_API_KEY || CURSOR_API_KEY;
}

function isClaudeCodeCompatibleModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('embed') || id.includes('legacy')) return false;
  return CLAUDE_LATEST_MAJOR_PATTERN.test(id);
}

function isCodexCompatibleModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!OPENAI_LATEST_MAJOR_PREFIXES.some(prefix => id.startsWith(prefix))) {
    return false;
  }
  if (id.includes('audio') || id.includes('realtime') || id.includes('embed')) {
    return false;
  }
  if (id.includes(':ft-') || id.includes('ft:')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Provider: Anthropic (Claude)
// ---------------------------------------------------------------------------

async function fetchClaudeModels(): Promise<AgentModelRow[]> {
  if (!ANTHROPIC_API_KEY) return [];

  const models: AgentModelRow[] = [];
  let hasMore = true;
  let afterId: string | undefined;

  while (hasMore) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '100');
    if (afterId) url.searchParams.set('after_id', afterId);

    const res = await fetch(url.toString(), {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!res.ok) {
      console.error(`Anthropic API error: ${res.status} ${await res.text()}`);
      break;
    }

    const body = (await res.json()) as {
      data: Array<{
        id: string;
        display_name: string;
        type: string;
      }>;
      has_more: boolean;
      last_id?: string;
    };

    for (const m of body.data) {
      // Filter to chat/text models only
      if (m.type !== 'model') continue;

      const id = m.id.toLowerCase();
      if (!isClaudeCodeCompatibleModel(id)) continue;

      const thinkingOptions = extractClaudeThinkingOptions(id);
      const isRecommended = id.includes('opus') || id.includes('sonnet');

      models.push({
        agent_type: 'claude',
        model_id: m.id,
        display_name: m.display_name || formatModelName(m.id),
        thinking_options: thinkingOptions,
        capabilities: buildCapabilities(['claude']),
        is_recommended: isRecommended,
        sort_order: getClaudeSortOrder(id),
        updated_at: new Date().toISOString()
      });
    }

    hasMore = body.has_more;
    afterId = body.last_id;
  }

  return models;
}

function extractClaudeThinkingOptions(modelId: string): string[] {
  // Claude 4.x models support extended thinking with budget levels.
  if (modelId.includes('mythos') || modelId.includes('opus') || modelId.includes('sonnet')) {
    return ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'];
  }
  return [];
}

function getClaudeSortOrder(modelId: string): number {
  if (modelId.includes('mythos-4')) return 10;
  if (modelId.includes('opus-4')) return 20;
  if (modelId.includes('sonnet-4')) return 20;
  if (modelId.includes('haiku-4')) return 30;
  if (modelId.includes('opus')) return 40;
  if (modelId.includes('sonnet')) return 50;
  if (modelId.includes('haiku')) return 60;
  return 100;
}

// ---------------------------------------------------------------------------
// Provider: OpenAI (Codex)
// ---------------------------------------------------------------------------

// Reasoning-effort levels accepted by the Codex CLI's
// `-c model_reasoning_effort="<level>"` flag for the gpt-5 / codex-5 family.
// The OpenAI API does not expose these per-model, so we apply the full
// supported ladder to every reasoning-capable Codex model.
const CODEX_REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// Substrings identifying gpt-5 variants that are NOT reasoning models and so
// must not advertise reasoning-effort options even though they pass the Codex
// compatibility filter (e.g. the chat-tuned and search models).
const OPENAI_NON_REASONING_MARKERS = ['chat-latest', 'search-api'];

async function fetchOpenAIModels(): Promise<AgentModelRow[]> {
  if (!OPENAI_API_KEY) return [];

  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
  });

  if (!res.ok) {
    console.error(`OpenAI API error: ${res.status} ${await res.text()}`);
    return [];
  }

  const body = (await res.json()) as {
    data: Array<{ id: string; owned_by: string }>;
  };

  const models: AgentModelRow[] = [];

  for (const m of body.data) {
    const id = m.id.toLowerCase();

    if (!isCodexCompatibleModel(id)) continue;

    // Codex reasoning models expose model_reasoning_effort via the CLI.
    const thinkingOptions = getCodexThinkingOptions(id);
    const isRecommended = id.startsWith('gpt-5') || id.startsWith('codex-5');

    models.push({
      agent_type: 'codex',
      model_id: m.id,
      display_name: formatModelName(m.id),
      thinking_options: thinkingOptions,
      capabilities: buildCapabilities(['codex']),
      is_recommended: isRecommended,
      sort_order: getOpenAISortOrder(id),
      updated_at: new Date().toISOString()
    });
  }

  return models;
}

function getCodexThinkingOptions(modelId: string): string[] {
  const id = modelId.toLowerCase();
  if (OPENAI_NON_REASONING_MARKERS.some(marker => id.includes(marker))) {
    return [];
  }
  return [...CODEX_REASONING_LEVELS];
}

function getOpenAISortOrder(modelId: string): number {
  if (modelId.startsWith('o4')) return 10;
  if (modelId.startsWith('o3-pro')) return 15;
  if (modelId.startsWith('o3')) return 20;
  if (modelId.startsWith('gpt-5')) return 30;
  if (modelId.startsWith('codex')) return 35;
  if (modelId.startsWith('gpt-4')) return 40;
  return 100;
}

// ---------------------------------------------------------------------------
// Connector: Antigravity (managed model selection)
// ---------------------------------------------------------------------------

/** Antigravity CLI chooses models internally; Overlord does not pass --model at launch. */
function buildAntigravityCatalogModels(): AgentModelRow[] {
  return [
    {
      agent_type: 'antigravity',
      model_id: 'auto',
      display_name: 'Antigravity default',
      thinking_options: [],
      capabilities: buildCapabilities(['antigravity']),
      is_recommended: true,
      sort_order: 0,
      updated_at: new Date().toISOString()
    }
  ];
}

// ---------------------------------------------------------------------------
// Provider: Cursor
// ---------------------------------------------------------------------------

async function fetchCursorModels(): Promise<AgentModelRow[]> {
  const apiKey = resolveCursorApiKey();
  if (!apiKey) return [];

  const basicAuth = btoa(`${apiKey}:`);
  const res = await fetch('https://api.cursor.com/v0/models', {
    headers: {
      Authorization: `Basic ${basicAuth}`
    }
  });

  if (!res.ok) {
    console.error(`Cursor API error: ${res.status} ${await res.text()}`);
    return [];
  }

  const body = (await res.json()) as {
    models?: string[];
  };

  const models: AgentModelRow[] = [];

  for (const modelId of body.models ?? []) {
    const id = modelId.trim().toLowerCase();
    if (!id || id === 'default') continue;

    models.push({
      agent_type: 'cursor',
      model_id: modelId,
      display_name: formatModelName(modelId),
      thinking_options: [],
      capabilities: buildCapabilities(['cursor']),
      is_recommended: id.includes('sonnet') || id.includes('gpt-5') || id.includes('composer'),
      sort_order: getCursorSortOrder(id),
      updated_at: new Date().toISOString()
    });
  }

  return models;
}

function getCursorSortOrder(modelId: string): number {
  if (modelId.includes('composer')) return 10;
  if (modelId.includes('opus')) return 20;
  if (modelId.includes('sonnet')) return 30;
  if (modelId.includes('gpt-5')) return 40;
  if (modelId.includes('gemini-3')) return 50;
  if (modelId.includes('gemini-2.5')) return 60;
  return 100;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatModelName(modelId: string): string {
  return modelId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/(\d)([a-z])/gi, '$1 $2')
    .trim();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const results: Record<string, { count: number; error?: string }> = {};

  // Fetch from all providers in parallel
  const [claudeModels, openaiModels, cursorModels] = await Promise.allSettled([
    fetchClaudeModels(),
    fetchOpenAIModels(),
    fetchCursorModels()
  ]);
  const antigravityModels = buildAntigravityCatalogModels();

  const allModels: AgentModelRow[] = [];

  if (claudeModels.status === 'fulfilled') {
    allModels.push(...claudeModels.value);
    results.claude = { count: claudeModels.value.length };
  } else {
    results.claude = { count: 0, error: String(claudeModels.reason) };
  }

  if (openaiModels.status === 'fulfilled') {
    allModels.push(...openaiModels.value);
    results.codex = { count: openaiModels.value.length };
  } else {
    results.codex = { count: 0, error: String(openaiModels.reason) };
  }

  allModels.push(...antigravityModels);
  results.antigravity = { count: antigravityModels.length };

  if (cursorModels.status === 'fulfilled') {
    allModels.push(...cursorModels.value);
    results.cursor = { count: cursorModels.value.length };
  } else {
    results.cursor = { count: 0, error: String(cursorModels.reason) };
  }

  const { error: legacyGeminiDeleteError } = await supabase
    .from('agent_models')
    .delete()
    .eq('agent_type', 'gemini');
  if (legacyGeminiDeleteError) {
    console.error('Failed to remove legacy gemini agent_models rows:', legacyGeminiDeleteError);
    results.gemini = { count: 0, error: legacyGeminiDeleteError.message };
  } else {
    results.gemini = { count: 0 };
  }

  // Upsert all models. ignoreDuplicates defaults to false, so on a
  // (agent_type, model_id) conflict every column — including thinking_options —
  // is overwritten. This guarantees each sync ALWAYS refreshes the reasoning
  // levels for existing rows, not just newly inserted ones.
  if (allModels.length > 0) {
    const { error } = await supabase.from('agent_models').upsert(allModels, {
      onConflict: 'agent_type,model_id',
      ignoreDuplicates: false
    });

    if (error) {
      console.error('Upsert error:', error);
      return new Response(
        JSON.stringify({
          error: 'Failed to upsert models',
          details: error.message
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }
  }

  // Clean up models that no longer exist in provider APIs
  // Get all current model IDs per agent_type from what we just fetched
  const currentModelKeys = new Set(allModels.map(m => `${m.agent_type}:${m.model_id}`));
  const agentTypesQueried = [...new Set(allModels.map(m => m.agent_type))];

  if (agentTypesQueried.length > 0) {
    const { data: existingModels } = await supabase
      .from('agent_models')
      .select('id, agent_type, model_id')
      .in('agent_type', agentTypesQueried);

    if (existingModels) {
      const staleIds = existingModels
        .filter(m => !currentModelKeys.has(`${m.agent_type}:${m.model_id}`))
        .map(m => m.id);

      if (staleIds.length > 0) {
        await supabase.from('agent_models').delete().in('id', staleIds);
        results._staleRemoved = { count: staleIds.length };
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, results, totalModels: allModels.length }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
});
