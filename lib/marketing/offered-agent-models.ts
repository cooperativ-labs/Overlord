import type { AgentModel } from '@/lib/helpers/agent-model-catalog';

const UPDATED_AT = '2026-05-18T00:00:00.000Z';

/** Representative offered models for marketing demos when the DB catalog is empty. */
export const MARKETING_OFFERED_AGENT_MODELS: AgentModel[] = [
  {
    id: 'marketing-claude-opus-4-6',
    agent_type: 'claude',
    model_id: 'claude-opus-4-6',
    display_name: 'Claude Opus 4.6',
    thinking_options: ['low', 'medium', 'high', 'xhigh', 'max'],
    capabilities: { compatible_agents: ['claude'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 10,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-claude-sonnet-4-6',
    agent_type: 'claude',
    model_id: 'claude-sonnet-4-6',
    display_name: 'Claude Sonnet 4.6',
    thinking_options: ['low', 'medium', 'high', 'xhigh', 'max'],
    capabilities: { compatible_agents: ['claude'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 20,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-claude-haiku-4-5',
    agent_type: 'claude',
    model_id: 'claude-haiku-4-5',
    display_name: 'Claude Haiku 4.5',
    thinking_options: ['low', 'medium', 'high', 'xhigh', 'max'],
    capabilities: { compatible_agents: ['claude'] },
    is_offered: true,
    is_recommended: false,
    sort_order: 30,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-codex-gpt-5-4',
    agent_type: 'codex',
    model_id: 'gpt-5.4',
    display_name: 'GPT-5.4',
    thinking_options: ['low', 'medium', 'high'],
    capabilities: { compatible_agents: ['codex'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 10,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-codex-gpt-5-3-codex',
    agent_type: 'codex',
    model_id: 'gpt-5.3-codex',
    display_name: 'GPT-5.3 Codex',
    thinking_options: ['low', 'medium', 'high'],
    capabilities: { compatible_agents: ['codex'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 20,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-cursor-composer',
    agent_type: 'cursor',
    model_id: 'composer-2',
    display_name: 'Composer 2',
    thinking_options: [],
    capabilities: { compatible_agents: ['cursor'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 10,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-cursor-sonnet',
    agent_type: 'cursor',
    model_id: 'claude-sonnet-4-6',
    display_name: 'Claude Sonnet 4.6',
    thinking_options: [],
    capabilities: { compatible_agents: ['cursor'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 30,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-cursor-gpt-5-4',
    agent_type: 'cursor',
    model_id: 'gpt-5.4',
    display_name: 'GPT-5.4',
    thinking_options: [],
    capabilities: { compatible_agents: ['cursor'] },
    is_offered: true,
    is_recommended: false,
    sort_order: 40,
    updated_at: UPDATED_AT
  },
  {
    id: 'marketing-antigravity-auto',
    agent_type: 'antigravity',
    model_id: 'auto',
    display_name: 'Antigravity default',
    thinking_options: [],
    capabilities: { compatible_agents: ['antigravity'] },
    is_offered: true,
    is_recommended: true,
    sort_order: 10,
    updated_at: UPDATED_AT
  }
];

export function resolveMarketingAgentModels(fetched: AgentModel[]): AgentModel[] {
  return fetched.length > 0 ? fetched : MARKETING_OFFERED_AGENT_MODELS;
}
