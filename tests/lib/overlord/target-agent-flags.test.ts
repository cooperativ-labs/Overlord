import { resolveTargetAgentLaunch } from '@/lib/overlord/target-agent-flags';

type Row = { agent_flags: unknown } | null;

/** Minimal chainable Supabase stub for the single-row select used by the resolver. */
function fakeClient(row: Row, error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: error ? null : row, error })
  };
  return { from: () => builder } as never;
}

describe('resolveTargetAgentLaunch', () => {
  it('returns a configured result for the requested agent', async () => {
    const client = fakeClient({
      agent_flags: { claude: { flags: ['--x'], preCommand: 'ollama' } }
    });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      kind: 'configured',
      flags: ['--x'],
      preCommand: 'ollama'
    });
  });

  it('returns not_configured when the target has no entry for the agent', async () => {
    const client = fakeClient({ agent_flags: { codex: { flags: ['--y'] } } });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      kind: 'not_configured'
    });
  });

  it('returns not_configured when the row is missing or the agent is blank', async () => {
    expect(await resolveTargetAgentLaunch(fakeClient(null), 'u1', 't1', 'claude')).toEqual({
      kind: 'not_configured'
    });
    expect(await resolveTargetAgentLaunch(fakeClient({ agent_flags: {} }), 'u1', 't1', '')).toEqual(
      { kind: 'not_configured' }
    );
  });

  it('returns an error result when the lookup itself fails', async () => {
    const client = fakeClient(null, { message: 'connection reset' });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      kind: 'error',
      error: 'connection reset'
    });
  });

  it('normalizes a blank pre-command to null', async () => {
    const client = fakeClient({ agent_flags: { claude: { flags: [], preCommand: '   ' } } });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      kind: 'configured',
      flags: [],
      preCommand: null
    });
  });

  it('treats an explicit empty config as configured so fallback launch params stay disabled', async () => {
    const client = fakeClient({ agent_flags: { claude: { flags: [] } } });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      kind: 'configured',
      flags: [],
      preCommand: null
    });
  });
});
