'use server';

import { createClient } from '@/supabase/utils/server';

export type AiProvider = 'claude-code' | 'codex';

export type UsageWindow = {
  used: number;
  limit: number | null;
  resetsAt: string | null;
};

export type AiUsageData = {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  plan: string | null;
};

export type AiConnectionStatus = {
  connected: boolean;
  updatedAt: string | null;
};

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  return { supabase, userId: user.id };
}

export async function getAiConnectionStatus(
  provider: AiProvider
): Promise<AiConnectionStatus> {
  const { supabase, userId } = await getAuthenticatedUser();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('updated_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return {
    connected: Boolean(data),
    updatedAt: (data?.updated_at as string | undefined) ?? null
  };
}

export async function disconnectAiProvider(provider: AiProvider): Promise<void> {
  const { supabase, userId } = await getAuthenticatedUser();
  const { error } = await supabase
    .from('user_integrations')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);

  if (error) throw new Error(error.message);
}

function extractWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const used =
    typeof obj.usage === 'number'
      ? obj.usage
      : typeof obj.used === 'number'
        ? obj.used
        : typeof obj.count === 'number'
          ? obj.count
          : null;
  if (used === null) return null;

  const limit =
    typeof obj.limit === 'number' ? obj.limit : typeof obj.max === 'number' ? obj.max : null;

  const resetsAt =
    typeof obj.resets_at === 'string'
      ? obj.resets_at
      : typeof obj.reset_at === 'string'
        ? obj.reset_at
        : typeof obj.resets_at_ms === 'number'
          ? new Date(obj.resets_at_ms).toISOString()
          : null;

  return { used, limit, resetsAt };
}

async function fetchClaudeUsage(accessToken: string): Promise<AiUsageData> {
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Claude usage request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    fiveHour: extractWindow(data.five_hour),
    sevenDay: extractWindow(data.seven_day),
    plan: typeof data.rate_limit_tier === 'string' ? data.rate_limit_tier : null
  };
}

async function fetchCodexUsage(accessToken: string): Promise<AiUsageData> {
  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Codex usage request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    fiveHour: extractWindow(data.five_hour ?? data.rate_limit_5h ?? data['5h']),
    sevenDay: extractWindow(data.seven_day ?? data.rate_limit_7d ?? data['7d'] ?? data.weekly),
    plan: typeof data.plan === 'string' ? data.plan : null
  };
}

export async function getAiUsage(provider: AiProvider): Promise<AiUsageData> {
  const { supabase, userId } = await getAuthenticatedUser();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('api_key')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Not connected.');

  const accessToken = data.api_key as string;
  if (provider === 'claude-code') return fetchClaudeUsage(accessToken);
  return fetchCodexUsage(accessToken);
}
