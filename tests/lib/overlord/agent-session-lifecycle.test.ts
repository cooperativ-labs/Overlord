import type { SupabaseClient } from '@supabase/supabase-js';

import {
  canReattachExecutingObjective,
  completeActiveAgentSessionsForObjective,
  disconnectActiveAgentSessionsForObjective,
  isProtocolUsableSessionState
} from '@/lib/overlord/agent-session-lifecycle';
import type { Database } from '@/types/database.types';

const OBJECTIVE_ID = 'dddddddd-0000-4000-8000-000000000099';

function makeSupabase(updateResult: { error: unknown }) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['update', 'eq', 'in']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(updateResult).then(resolve);

  const supabase = {
    from: jest.fn(() => builder)
  } as unknown as SupabaseClient<Database>;

  return { supabase, builder };
}

describe('agent-session-lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-12T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('disconnectActiveAgentSessionsForObjective marks active sessions disconnected', async () => {
    const { supabase, builder } = makeSupabase({ error: null });

    await disconnectActiveAgentSessionsForObjective({ supabase, objectiveId: OBJECTIVE_ID });

    expect(supabase.from).toHaveBeenCalledWith('agent_sessions');
    expect(builder.update).toHaveBeenCalledWith({
      session_state: 'disconnected',
      detached_at: '2026-06-12T12:00:00.000Z'
    });
    expect(builder.eq).toHaveBeenCalledWith('objective_id', OBJECTIVE_ID);
    expect(builder.in).toHaveBeenCalledWith('session_state', ['attached', 'idle', 'blocked']);
  });

  it('completeActiveAgentSessionsForObjective marks active sessions completed', async () => {
    const { supabase, builder } = makeSupabase({ error: null });

    await completeActiveAgentSessionsForObjective({ supabase, objectiveId: OBJECTIVE_ID });

    expect(supabase.from).toHaveBeenCalledWith('agent_sessions');
    expect(builder.update).toHaveBeenCalledWith({
      session_state: 'completed',
      detached_at: '2026-06-12T12:00:00.000Z'
    });
    expect(builder.eq).toHaveBeenCalledWith('objective_id', OBJECTIVE_ID);
    expect(builder.in).toHaveBeenCalledWith('session_state', ['attached', 'idle', 'blocked']);
  });

  it('throws when the session update fails', async () => {
    const { supabase } = makeSupabase({ error: { message: 'update failed' } });

    await expect(
      disconnectActiveAgentSessionsForObjective({ supabase, objectiveId: OBJECTIVE_ID })
    ).rejects.toThrow('update failed');
  });

  it('isProtocolUsableSessionState only accepts attached sessions by default', () => {
    expect(isProtocolUsableSessionState('attached')).toBe(true);
    expect(isProtocolUsableSessionState('disconnected')).toBe(false);
    expect(isProtocolUsableSessionState('completed')).toBe(false);
    expect(isProtocolUsableSessionState('completed', { allowCompletedReactivation: true })).toBe(
      true
    );
  });

  it('canReattachExecutingObjective rejects objectives whose latest session completed', async () => {
    const selectQuery = {
      select: jest.fn(() => selectQuery),
      eq: jest.fn(() => selectQuery),
      order: jest.fn(() => selectQuery),
      limit: jest.fn(() => selectQuery),
      maybeSingle: jest.fn(async () => ({ data: { session_state: 'completed' }, error: null }))
    };
    const supabase = { from: jest.fn(() => selectQuery) } as unknown as SupabaseClient<Database>;

    await expect(
      canReattachExecutingObjective({ supabase, objectiveId: OBJECTIVE_ID })
    ).resolves.toBe(false);
  });

  it('canReattachExecutingObjective allows recovery when the latest session disconnected', async () => {
    const selectQuery = {
      select: jest.fn(() => selectQuery),
      eq: jest.fn(() => selectQuery),
      order: jest.fn(() => selectQuery),
      limit: jest.fn(() => selectQuery),
      maybeSingle: jest.fn(async () => ({ data: { session_state: 'disconnected' }, error: null }))
    };
    const supabase = { from: jest.fn(() => selectQuery) } as unknown as SupabaseClient<Database>;

    await expect(
      canReattachExecutingObjective({ supabase, objectiveId: OBJECTIVE_ID })
    ).resolves.toBe(true);
  });
});
