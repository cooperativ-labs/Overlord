import { type AgentModelCatalog, applyAgentModelCatalog } from '@/lib/helpers/agent-model-catalog';

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
  toMatchObject: (expected: unknown) => void;
};

describe('applyAgentModelCatalog', () => {
  const dbModels = [
    {
      id: 'db-claude-1',
      agent_type: 'claude',
      model_id: 'claude-sonnet',
      display_name: 'Claude Sonnet',
      thinking_options: ['medium'],
      capabilities: {},
      is_recommended: true,
      sort_order: 10,
      updated_at: '2026-03-19T10:00:00.000Z'
    },
    {
      id: 'db-codex-1',
      agent_type: 'codex',
      model_id: 'old-codex',
      display_name: 'Old Codex',
      thinking_options: ['high'],
      capabilities: {},
      is_recommended: true,
      sort_order: 20,
      updated_at: '2026-03-19T10:00:00.000Z'
    }
  ];

  it('replaces an agent model list when the catalog provides an override array', () => {
    const catalog: AgentModelCatalog = {
      version: 1,
      agents: {
        codex: [
          {
            id: 'gpt-5.4',
            label: '5.4',
            thinkingLevels: ['minimal', 'low', 'medium', 'high']
          },
          {
            id: 'gpt-5.4-mini',
            label: '5.4 mini',
            thinkingLevels: ['minimal', 'low', 'medium', 'high']
          }
        ]
      }
    };

    expect(applyAgentModelCatalog(dbModels, catalog, 'codex')).toMatchObject([
      {
        agent_type: 'codex',
        model_id: 'gpt-5.4',
        display_name: '5.4',
        thinking_options: ['minimal', 'low', 'medium', 'high'],
        sort_order: 0
      },
      {
        agent_type: 'codex',
        model_id: 'gpt-5.4-mini',
        display_name: '5.4 mini',
        thinking_options: ['minimal', 'low', 'medium', 'high'],
        sort_order: 1
      }
    ]);
  });

  it('falls back to the database model list when the catalog value is null', () => {
    const catalog: AgentModelCatalog = {
      version: 1,
      agents: {
        codex: null
      }
    };

    expect(applyAgentModelCatalog(dbModels, catalog, 'codex')).toEqual([dbModels[1]]);
  });
});
