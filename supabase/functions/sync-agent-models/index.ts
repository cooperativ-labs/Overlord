/// <reference lib="deno.ns" />
/**
 * sync-agent-models — Supabase Edge Function
 *
 * Queries provider APIs (Anthropic, OpenAI, Google Gemini, Cursor) for available
 * models and upserts them into the `agent_models` table. Intended to be called
 * on a cron schedule (every 12 hours).
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

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

      // Skip non-coding-relevant models (embeddings, legacy, etc.)
      const id = m.id.toLowerCase();
      if (id.includes('embed') || id.includes('legacy')) continue;

      const thinkingOptions = extractClaudeThinkingOptions(id);
      const isRecommended = id.includes('opus') || id.includes('sonnet');

      models.push({
        agent_type: 'claude',
        model_id: m.id,
        display_name: m.display_name || formatModelName(m.id),
        thinking_options: thinkingOptions,
        capabilities: {},
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
  // Claude 4.x and 3.5+ models support extended thinking with budget levels
  if (modelId.includes('opus') || modelId.includes('sonnet') || modelId.includes('haiku')) {
    return ['low', 'medium', 'high', 'max'];
  }
  return [];
}

function getClaudeSortOrder(modelId: string): number {
  if (modelId.includes('opus-4')) return 10;
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

// OpenAI doesn't expose capabilities via API, so we use a lookup map
const OPENAI_REASONING_MODELS: Record<string, string[]> = {
  o3: ['low', 'medium', 'high'],
  'o3-mini': ['low', 'medium', 'high'],
  'o3-pro': ['low', 'medium', 'high'],
  'o4-mini': ['low', 'medium', 'high'],
  o4: ['low', 'medium', 'high']
};

const OPENAI_MODEL_FILTER = ['gpt-5', 'gpt-4', 'o3', 'o4', 'codex'];

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

    // Filter to coding-relevant models
    if (!OPENAI_MODEL_FILTER.some(prefix => id.startsWith(prefix))) continue;
    // Skip fine-tuned, audio, realtime, embedding variants
    if (id.includes('audio') || id.includes('realtime') || id.includes('embed')) continue;
    if (id.includes(':ft-') || id.includes('ft:')) continue;

    // Check if this is a reasoning model
    const thinkingOptions = getOpenAIThinkingOptions(id);
    const isRecommended = id.startsWith('o4') || id.startsWith('gpt-5') || id.startsWith('codex');

    models.push({
      agent_type: 'codex',
      model_id: m.id,
      display_name: formatModelName(m.id),
      thinking_options: thinkingOptions,
      capabilities: {},
      is_recommended: isRecommended,
      sort_order: getOpenAISortOrder(id),
      updated_at: new Date().toISOString()
    });
  }

  return models;
}

function getOpenAIThinkingOptions(modelId: string): string[] {
  const id = modelId.toLowerCase();
  for (const [prefix, options] of Object.entries(OPENAI_REASONING_MODELS)) {
    if (id.startsWith(prefix)) return options;
  }
  return [];
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
// Provider: Google Gemini
// ---------------------------------------------------------------------------

async function fetchGeminiModels(): Promise<AgentModelRow[]> {
  if (!GEMINI_API_KEY) return [];

  const models: AgentModelRow[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', GEMINI_API_KEY);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());

    if (!res.ok) {
      console.error(`Gemini API error: ${res.status} ${await res.text()}`);
      break;
    }

    const body = (await res.json()) as {
      models: Array<{
        name: string;
        displayName: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    };

    for (const m of body.models ?? []) {
      // Extract model ID from "models/gemini-2.5-pro" format
      const modelId = m.name.replace('models/', '');
      const id = modelId.toLowerCase();

      // Filter to Gemini 2.5+ coding-relevant models
      if (!id.startsWith('gemini-2.5') && !id.startsWith('gemini-3')) continue;
      // Skip non-text models
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue;

      const thinkingOptions = getGeminiThinkingOptions(id);

      models.push({
        agent_type: 'gemini',
        model_id: modelId,
        display_name: m.displayName || formatModelName(modelId),
        thinking_options: thinkingOptions,
        capabilities: {},
        is_recommended: id.includes('pro') || id.includes('flash'),
        sort_order: getGeminiSortOrder(id),
        updated_at: new Date().toISOString()
      });
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return models;
}

function getGeminiThinkingOptions(modelId: string): string[] {
  if (modelId.includes('2.5')) {
    return ['low', 'medium', 'high'];
  }
  if (modelId.includes('3')) {
    return ['minimal', 'low', 'medium', 'high'];
  }
  return [];
}

function getGeminiSortOrder(modelId: string): number {
  if (modelId.includes('3') && modelId.includes('pro')) return 10;
  if (modelId.includes('3')) return 20;
  if (modelId.includes('2.5') && modelId.includes('pro')) return 30;
  if (modelId.includes('2.5') && modelId.includes('flash')) return 40;
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
  const [claudeModels, openaiModels, geminiModels] = await Promise.allSettled([
    fetchClaudeModels(),
    fetchOpenAIModels(),
    fetchGeminiModels()
  ]);

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

  if (geminiModels.status === 'fulfilled') {
    allModels.push(...geminiModels.value);
    results.gemini = { count: geminiModels.value.length };
  } else {
    results.gemini = { count: 0, error: String(geminiModels.reason) };
  }

  // Upsert all models
  if (allModels.length > 0) {
    const { error } = await supabase.from('agent_models').upsert(allModels, {
      onConflict: 'agent_type,model_id'
    });

    if (error) {
      console.error('Upsert error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to upsert models', details: error.message }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
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
