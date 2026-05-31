import {
  assignedAgentSelectionToJson,
  createTicketAssignedAgent,
  parseTicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';

describe('assignedAgentSelectionToJson', () => {
  it('stores a custom agent slug in the agent field', () => {
    expect(
      assignedAgentSelectionToJson({
        agent: 'claude',
        model: 'local-llm',
        thinking: null,
        customAgentId: 'my-harness'
      })
    ).toEqual({
      agent: 'my-harness',
      model: 'local-llm',
      thinking: null
    });
  });
});

describe('parseTicketAssignedAgent', () => {
  it('round-trips a built-in agent assignment', () => {
    const selection = createTicketAssignedAgent({
      agent: 'codex',
      model: 'gpt-5.4',
      thinking: 'high'
    });

    expect(parseTicketAssignedAgent(assignedAgentSelectionToJson(selection))).toEqual(selection);
  });

  it('round-trips a custom agent assignment', () => {
    const selection = createTicketAssignedAgent({
      agent: 'claude',
      model: 'local-llm',
      thinking: null,
      customAgentId: 'my-harness'
    });

    expect(selection.customAgentId).toBe('my-harness');
    expect(parseTicketAssignedAgent(assignedAgentSelectionToJson(selection))?.customAgentId).toBe(
      'my-harness'
    );
  });
});
