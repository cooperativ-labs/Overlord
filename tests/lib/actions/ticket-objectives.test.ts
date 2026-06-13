jest.mock('next/cache', () => ({
  revalidatePath: jest.fn()
}));

jest.mock('@/lib/helpers/ticket-path', () => ({
  buildProjectPath: jest.fn(() => '/orgs/1/projects/project-1')
}));

jest.mock('@/lib/objectives', () => ({
  computePromotedObjectivePositions: jest.fn(),
  computeReorderedObjectivePositions: jest.fn(),
  persistObjectivePositions: jest.fn(),
  promoteNextFutureDraft: jest.fn(async () => false)
}));

jest.mock('@/lib/overlord/agent-session-lifecycle', () => ({
  completeActiveAgentSessionsForObjective: jest.fn(async () => undefined),
  disconnectActiveAgentSessionsForObjective: jest.fn(async () => undefined)
}));

jest.mock('@/lib/overlord/execution-requests', () => ({
  failActiveExecutionRequestsForObjective: jest.fn(async () => ({ failedCount: 1 }))
}));

jest.mock('@/supabase/utils/server', () => ({
  createClientForRequest: jest.fn()
}));

jest.mock('@/lib/actions/tickets/internals', () => ({
  assertTicketAccess: jest.fn(),
  revalidateTicketBoards: jest.fn(),
  revalidateTicketDetails: jest.fn()
}));

import {
  markObjectiveDraftAction,
  markObjectiveExecutedAction
} from '@/lib/actions/tickets/ticket-objectives';

const TICKET_ID = 'ticket-1';
const OBJECTIVE_ID = 'objective-1';

function createEqSingleBuilder<T>(data: T) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(async () => ({ data, error: null }))
  };
  return builder;
}

describe('ticket objective actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('markObjectiveDraftAction disconnects sessions and clears active execution requests', async () => {
    const objectivesSelect = {
      select: jest.fn(() => objectivesSelect),
      eq: jest.fn(() => objectivesSelect),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [
            { id: OBJECTIVE_ID, state: 'executing', objective: 'Ship it' },
            { id: 'draft-2', state: 'draft', objective: 'Existing draft' }
          ],
          error: null
        }).then(resolve)
    };
    const demoteDrafts = {
      update: jest.fn(() => demoteDrafts),
      eq: jest.fn(() => demoteDrafts),
      neq: jest.fn(async () => ({ error: null }))
    };
    const markDraft = {
      update: jest.fn(() => markDraft),
      eq: jest.fn(async () => ({ error: null }))
    };
    const ticketSelect = createEqSingleBuilder({
      organization_id: 1,
      project_id: 'project-1'
    });
    const ticketEvents = {
      insert: jest.fn(async () => ({ error: null }))
    };
    const supabase = {
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } }))
      },
      from: jest
        .fn()
        .mockReturnValueOnce(objectivesSelect)
        .mockReturnValueOnce(demoteDrafts)
        .mockReturnValueOnce(markDraft)
        .mockReturnValueOnce(ticketSelect)
        .mockReturnValueOnce(ticketEvents)
    };

    const { createClientForRequest } = jest.requireMock('@/supabase/utils/server');
    const { disconnectActiveAgentSessionsForObjective } = jest.requireMock(
      '@/lib/overlord/agent-session-lifecycle'
    );
    const { failActiveExecutionRequestsForObjective } = jest.requireMock(
      '@/lib/overlord/execution-requests'
    );
    createClientForRequest.mockResolvedValue(supabase);

    await markObjectiveDraftAction(TICKET_ID, OBJECTIVE_ID);

    expect(disconnectActiveAgentSessionsForObjective).toHaveBeenCalledWith({
      supabase,
      objectiveId: OBJECTIVE_ID
    });
    expect(failActiveExecutionRequestsForObjective).toHaveBeenCalledWith({
      supabase,
      organizationId: 1,
      objectiveId: OBJECTIVE_ID,
      requestedBy: 'user-1'
    });
  });

  it('markObjectiveExecutedAction completes sessions and clears active execution requests', async () => {
    const objectiveSelect = createEqSingleBuilder({
      id: OBJECTIVE_ID,
      state: 'executing',
      objective: '',
      ticket_id: TICKET_ID,
      assigned_agent: null
    });
    const markComplete = {
      update: jest.fn(() => markComplete),
      eq: jest.fn(async () => ({ error: null }))
    };
    const ticketSelect = createEqSingleBuilder({
      organization_id: 1,
      project_id: 'project-1'
    });
    const ticketEvents = {
      insert: jest.fn(async () => ({ error: null }))
    };
    const supabase = {
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } }))
      },
      from: jest
        .fn()
        .mockReturnValueOnce(objectiveSelect)
        .mockReturnValueOnce(markComplete)
        .mockReturnValueOnce(ticketSelect)
        .mockReturnValueOnce(ticketEvents)
    };

    const { createClientForRequest } = jest.requireMock('@/supabase/utils/server');
    const { completeActiveAgentSessionsForObjective } = jest.requireMock(
      '@/lib/overlord/agent-session-lifecycle'
    );
    const { failActiveExecutionRequestsForObjective } = jest.requireMock(
      '@/lib/overlord/execution-requests'
    );
    createClientForRequest.mockResolvedValue(supabase);

    await markObjectiveExecutedAction(TICKET_ID, OBJECTIVE_ID);

    expect(completeActiveAgentSessionsForObjective).toHaveBeenCalledWith({
      supabase,
      objectiveId: OBJECTIVE_ID
    });
    expect(failActiveExecutionRequestsForObjective).toHaveBeenCalledWith({
      supabase,
      organizationId: 1,
      objectiveId: OBJECTIVE_ID,
      requestedBy: 'user-1'
    });
  });
});
