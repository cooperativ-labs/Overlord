import { filterOfferedAgentModels } from '@/lib/helpers/agent-model-catalog';

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
};

describe('filterOfferedAgentModels', () => {
  const dbModels = [
    {
      id: 'db-claude-1',
      agent_type: 'claude',
      model_id: 'claude-sonnet',
      display_name: 'Claude Sonnet',
      thinking_options: ['medium'],
      capabilities: {},
      is_offered: true,
      is_recommended: true,
      sort_order: 10,
      updated_at: '2026-03-19T10:00:00.000Z'
    },
    {
      id: 'db-codex-1',
      agent_type: 'codex',
      model_id: 'gpt-5.4',
      display_name: 'GPT-5.4',
      thinking_options: ['high'],
      capabilities: {},
      is_offered: false,
      is_recommended: true,
      sort_order: 20,
      updated_at: '2026-03-19T10:00:00.000Z'
    }
  ];

  it('returns only offered models across all agents', () => {
    expect(filterOfferedAgentModels(dbModels)).toEqual([dbModels[0]]);
  });

  it('returns only offered models for the requested agent', () => {
    expect(filterOfferedAgentModels(dbModels, 'codex')).toEqual([]);
  });
});
