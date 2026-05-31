import {
  AGENT_MODEL_OPTIONS,
  getAgentThinkingLabel,
  supportsBuiltInThinkingSelection
} from '@/components/features/AgentModelSelector';
import { LAUNCH_AGENT_VALUES } from '@/lib/helpers/agent-types';

describe('AgentModelSelector', () => {
  it('only exposes launchable agents in the selector list', () => {
    expect(AGENT_MODEL_OPTIONS.map(option => option.value)).toEqual(LAUNCH_AGENT_VALUES);
    expect(AGENT_MODEL_OPTIONS.every(option => !option.value.startsWith('copy-'))).toBe(true);
  });

  it('labels Codex thinking controls as effort', () => {
    expect(getAgentThinkingLabel('codex')).toBe('Effort');
    expect(getAgentThinkingLabel('claude')).toBe('Thinking');
  });

  it('allows built-in effort selection for Codex unless the agent manages models itself', () => {
    expect(supportsBuiltInThinkingSelection('codex', false)).toBe(true);
    expect(supportsBuiltInThinkingSelection('antigravity', true)).toBe(false);
    expect(supportsBuiltInThinkingSelection('cursor', false)).toBe(false);
  });
});
