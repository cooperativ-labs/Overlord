/** Bundled workspace agent catalog seeded when overlord.toml has no [agent_catalog]. */
export type CatalogAgent = {
  label: string;
  availableByDefault: boolean;
  models: Array<{ id: string; displayName: string; reasoningOptions: string[] }>;
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
  reasoningLabel: string;
};

export const BUNDLED_AGENT_CATALOG: Record<string, CatalogAgent> = {
  pi: {
    label: 'PI',
    availableByDefault: false,
    models: [
      {
        id: 'zai/glm-5.2',
        displayName: 'GLM 5.2',
        reasoningOptions: ['off', 'high', 'max']
      },
      {
        id: 'anthropic/claude-opus-4-8',
        displayName: 'Claude Opus 4.8',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max']
      },
      {
        id: 'openai-codex/gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        reasoningOptions: ['off', 'low', 'medium', 'high', 'xhigh', 'max']
      }
    ],
    defaultModel: null,
    defaultReasoningEffort: null,
    reasoningLabel: 'Thinking'
  },
  codex: {
    label: 'Codex',
    availableByDefault: true,
    models: [
      {
        id: 'gpt-6.1-sol',
        displayName: 'GPT-6.1-Sol',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max']
      },
      {
        id: 'gpt-6-astra',
        displayName: 'GPT-6-Astra',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max']
      },
      {
        id: 'gpt-6-sol',
        displayName: 'GPT-6-Sol',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max']
      },
      {
        id: 'gpt-6-luna',
        displayName: 'GPT-6-Luna',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max']
      }
    ],
    defaultModel: 'gpt-6.1-sol',
    defaultReasoningEffort: 'medium',
    reasoningLabel: 'Effort'
  },
  claude: {
    label: 'Claude Code',
    availableByDefault: true,
    models: [
      {
        id: 'claude-opus-5-5',
        displayName: 'Opus 5.5',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']
      },
      {
        id: 'claude-fable-5-1',
        displayName: 'Fable 5.1',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']
      },
      {
        id: 'claude-sonnet-5-5',
        displayName: 'Sonnet 5.5',
        reasoningOptions: ['low', 'medium', 'high', 'max']
      },
      {
        id: 'claude-haiku-4-5-20251001',
        displayName: 'Haiku 4.5',
        reasoningOptions: []
      }
    ],
    defaultModel: 'claude-opus-5-5',
    defaultReasoningEffort: null,
    reasoningLabel: 'Thinking'
  },
  cursor: {
    label: 'Cursor',
    availableByDefault: true,
    models: [
      { id: 'auto', displayName: 'Auto', reasoningOptions: [] },
      { id: 'composer-2.5', displayName: 'Composer 2.5', reasoningOptions: [] },
      {
        id: 'cursor-grok-4.6-high',
        displayName: 'Grok 4.6 High',
        reasoningOptions: []
      },
      {
        id: 'cursor-grok-4.6-xhigh',
        displayName: 'Grok 4.6 Xhigh',
        reasoningOptions: []
      },
      {
        id: 'grok-4.5-medium',
        displayName: 'Grok 4.5 Medium',
        reasoningOptions: []
      },
      {
        id: 'grok-4.5-high',
        displayName: 'Grok 4.5 High',
        reasoningOptions: []
      },
      {
        id: 'grok-4.5-xhigh',
        displayName: 'Grok 4.5 Xhigh',
        reasoningOptions: []
      },
      {
        id: 'grok-4.5-fast-high',
        displayName: 'Grok 4.5 Fast High',
        reasoningOptions: []
      },
      {
        id: 'grok-4.5-fast-medium',
        displayName: 'Grok 4.5 Fast Medium',
        reasoningOptions: []
      },
      {
        id: 'grok-4.5-fast-xhigh',
        displayName: 'Grok 4.5 Fast Xhigh',
        reasoningOptions: []
      },
      {
        id: 'gpt-6.1-sol',
        displayName: 'GPT-6.1-Sol',
        reasoningOptions: []
      },
      {
        id: 'gpt-6-astra',
        displayName: 'GPT-6-Astra',
        reasoningOptions: []
      },
      {
        id: 'gpt-6-sol',
        displayName: 'GPT-6-Sol',
        reasoningOptions: []
      },
      {
        id: 'gpt-6-luna',
        displayName: 'GPT-6-Luna',
        reasoningOptions: []
      },
      {
        id: 'glm-5.2-high',
        displayName: 'GLM 5.2 High',
        reasoningOptions: []
      },
      {
        id: 'claude-fable-5-thinking-high',
        displayName: 'Fable 5 High',
        reasoningOptions: []
      },
      {
        id: 'claude-fable-5-thinking-xhighmodel-16',
        displayName: 'Fable 5 XHigh',
        reasoningOptions: []
      }
    ],
    defaultModel: 'auto',
    defaultReasoningEffort: null,
    reasoningLabel: 'Thinking'
  }
};
