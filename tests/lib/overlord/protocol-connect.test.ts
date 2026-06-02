jest.mock('@/lib/objectives', () => ({
  markSubmittedObjectiveExecuting: jest.fn()
}));
jest.mock('@/lib/ticket-statuses', () => ({
  resolvePreferredStatusNameByType: jest.fn(),
  resolveStatusTypeForName: jest.fn()
}));

import { runConnectProtocol } from '@/lib/overlord/protocol-connect';

const TICKET_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const OBJECTIVE_ID = 'cccccccc-0000-4000-8000-000000000001';

describe('runConnectProtocol', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const { markSubmittedObjectiveExecuting } = jest.requireMock('@/lib/objectives');
    const { resolvePreferredStatusNameByType, resolveStatusTypeForName } =
      jest.requireMock('@/lib/ticket-statuses');

    markSubmittedObjectiveExecuting.mockResolvedValue({
      executedObjectiveId: OBJECTIVE_ID
    });
    resolveStatusTypeForName.mockResolvedValue('draft');
    resolvePreferredStatusNameByType.mockResolvedValue('Execute');
  });

  it('stores external_session_id on lightweight connect sessions', async () => {
    const ticketSelect = {
      select: jest.fn(() => ticketSelect),
      eq: jest.fn(() => ticketSelect),
      single: jest.fn(async () => ({
        data: { id: TICKET_ID, status: 'Todo' },
        error: null
      }))
    };

    const sessionDetach = {
      update: jest.fn(() => sessionDetach),
      eq: jest.fn(() => sessionDetach),
      in: jest.fn(async () => ({ error: null }))
    };

    const sessionInsert = {
      insert: jest.fn(() => sessionInsert),
      select: jest.fn(() => sessionInsert),
      single: jest.fn(async () => ({
        data: { id: 'session-1', session_key: 'session-key-1', session_state: 'attached' },
        error: null
      }))
    };

    const ticketUpdate = {
      update: jest.fn(() => ticketUpdate),
      eq: jest.fn(async () => ({ error: null }))
    };

    const ticketEvents = {
      insert: jest.fn(async () => ({ error: null }))
    };

    let ticketFromCount = 0;
    let sessionFromCount = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'tickets') {
          ticketFromCount += 1;
          if (ticketFromCount === 1) return ticketSelect;
          return ticketUpdate;
        }
        if (table === 'agent_sessions') {
          sessionFromCount += 1;
          if (sessionFromCount === 1) return sessionDetach;
          return sessionInsert;
        }
        if (table === 'ticket_events') return ticketEvents;
        throw new Error(`unexpected table ${table}`);
      })
    };

    const result = await runConnectProtocol(supabase as never, {
      ticketId: TICKET_ID,
      agentIdentifier: 'codex',
      connectionMethod: 'cli',
      externalSessionId: 'codex-thread-123',
      metadata: { cwd: '/tmp/repo' },
      organizationId: 1,
      userId: 'user-1'
    });

    expect(result.error).toBeNull();
    expect(sessionInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        external_session_id: 'codex-thread-123',
        agent_identifier: 'codex',
        connection_method: 'cli',
        objective_id: OBJECTIVE_ID
      })
    );
  });
});
