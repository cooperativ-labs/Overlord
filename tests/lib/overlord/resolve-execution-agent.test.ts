import {
  NO_ASSIGNED_AGENT_ERROR,
  parseExecutionAgentFromAssignment,
  requireExecutionAgentFromAssignment
} from '@/lib/overlord/resolve-execution-agent';

describe('parseExecutionAgentFromAssignment', () => {
  it('parses a built-in launch agent from an object assignment', () => {
    expect(
      parseExecutionAgentFromAssignment({
        agent: 'codex',
        model: 'gpt-5.4',
        thinking: 'high'
      })
    ).toEqual({
      agentIdentifier: 'codex',
      launchAgent: 'codex',
      customAgentId: null,
      modelIdentifier: 'gpt-5.4',
      thinkingLevel: 'high'
    });
  });

  it('parses a custom agent slug from an object assignment', () => {
    expect(
      parseExecutionAgentFromAssignment({
        agent: 'my-harness',
        model: 'local-llm',
        thinking: null
      })
    ).toEqual({
      agentIdentifier: 'my-harness',
      launchAgent: null,
      customAgentId: 'my-harness',
      modelIdentifier: 'local-llm',
      thinkingLevel: null
    });
  });

  it('parses legacy string assignments for built-in agents', () => {
    expect(parseExecutionAgentFromAssignment('codex')).toEqual({
      agentIdentifier: 'codex',
      launchAgent: 'codex',
      customAgentId: null,
      modelIdentifier: null,
      thinkingLevel: null
    });
  });

  it('returns null when assignment is missing or empty', () => {
    expect(parseExecutionAgentFromAssignment(null)).toBeNull();
    expect(parseExecutionAgentFromAssignment({})).toBeNull();
    expect(parseExecutionAgentFromAssignment({ agent: '   ' })).toBeNull();
  });
});

describe('requireExecutionAgentFromAssignment', () => {
  it('throws a clear error when no agent is assigned', () => {
    expect(() => requireExecutionAgentFromAssignment(null)).toThrow(NO_ASSIGNED_AGENT_ERROR);
  });

  it('returns the assigned built-in agent', () => {
    expect(
      requireExecutionAgentFromAssignment({
        agent: 'codex',
        model: 'gpt-5.4',
        thinking: null
      }).agentIdentifier
    ).toBe('codex');
  });
});
