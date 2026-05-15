import { AGENT_MODEL_OPTIONS } from '@/components/features/AgentModelSelector';

describe('AgentModelSelector', () => {
  it('only exposes launchable agents in the selector list', () => {
    expect(AGENT_MODEL_OPTIONS.map(option => option.value)).toEqual([
      'claude',
      'codex',
      'cursor',
      'gemini',
      'opencode'
    ]);
    expect(AGENT_MODEL_OPTIONS.every(option => !option.value.startsWith('copy-'))).toBe(true);
  });
});
