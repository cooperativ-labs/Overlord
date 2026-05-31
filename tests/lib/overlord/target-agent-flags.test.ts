import { resolveTargetAgentLaunch } from '@/lib/overlord/target-agent-flags';

type Row = { agent_flags: unknown } | null;

/** Minimal chainable Supabase stub for the single-row select used by the resolver. */
function fakeClient(row: Row) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error: null })
  };
  return { from: () => builder } as never;
}

describe('resolveTargetAgentLaunch', () => {
  it('returns the per-target config for the requested agent', async () => {
    const client = fakeClient({
      agent_flags: { claude: { flags: ['--x'], preCommand: 'ollama' } }
    });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      flags: ['--x'],
      preCommand: 'ollama'
    });
  });

  it('returns null when the target has no entry for the agent', async () => {
    const client = fakeClient({ agent_flags: { codex: { flags: ['--y'] } } });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toBeNull();
  });

  it('returns null when the row is missing or the agent is blank', async () => {
    expect(await resolveTargetAgentLaunch(fakeClient(null), 'u1', 't1', 'claude')).toBeNull();
    expect(
      await resolveTargetAgentLaunch(fakeClient({ agent_flags: {} }), 'u1', 't1', '')
    ).toBeNull();
  });

  it('normalizes a blank pre-command to null', async () => {
    const client = fakeClient({ agent_flags: { claude: { flags: [], preCommand: '   ' } } });
    expect(await resolveTargetAgentLaunch(client, 'u1', 't1', 'claude')).toEqual({
      flags: [],
      preCommand: null
    });
  });
});
