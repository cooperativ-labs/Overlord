import { AGENT_MODEL_OPTIONS } from '@/components/features/AgentModelSelector';
import { LAUNCH_AGENT_VALUES } from '@/lib/helpers/agent-types';

describe('AgentModelSelector', () => {
  it('only exposes launchable agents in the selector list', () => {
    expect(AGENT_MODEL_OPTIONS.map(option => option.value)).toEqual(LAUNCH_AGENT_VALUES);
    expect(AGENT_MODEL_OPTIONS.every(option => !option.value.startsWith('copy-'))).toBe(true);
  });
});
