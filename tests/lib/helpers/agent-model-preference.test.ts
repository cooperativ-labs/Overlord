import { resolveAgentModelSelection } from '@/lib/helpers/agent-model-preference';

describe('resolveAgentModelSelection', () => {
  it('prefers the saved launch preference when available', () => {
    expect(
      resolveAgentModelSelection(
        {
          claude: { flags: [], defaultModel: 'claude-default', defaultThinking: 'medium' },
          codex: { flags: [], defaultModel: 'codex-default', defaultThinking: 'high' }
        },
        { agent: 'codex', model: 'codex-5', thinking: 'max' }
      )
    ).toEqual({
      agent: 'codex',
      model: 'codex-5',
      thinking: 'max'
    });
  });

  it('falls back to the agent default model and thinking when the launch preference is incomplete', () => {
    expect(
      resolveAgentModelSelection(
        {
          claude: { flags: [], defaultModel: 'claude-default', defaultThinking: 'medium' }
        },
        { agent: 'claude', model: null, thinking: null }
      )
    ).toEqual({
      agent: 'claude',
      model: 'claude-default',
      thinking: 'medium'
    });
  });

  it('falls back to the first configured agent with a model when no launch preference exists', () => {
    expect(
      resolveAgentModelSelection({
        cursor: { flags: [] },
        gemini: { flags: [], defaultModel: 'gemini-default', defaultThinking: 'high' }
      })
    ).toEqual({
      agent: 'gemini',
      model: 'gemini-default',
      thinking: 'high'
    });
  });
});
