import { emitWorkflowNotification } from '@/lib/overlord/notifications/orchestrator';
import { sendPushNotification } from '@/lib/overlord/push-notifications';

jest.mock('@/lib/overlord/push-notifications', () => ({
  sendPushNotification: jest.fn()
}));

const mockSendPushNotification = jest.mocked(sendPushNotification);

describe('emitWorkflowNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendPushNotification.mockResolvedValue(undefined);
  });

  const baseInput = {
    supabase: {} as never,
    organizationId: 42,
    ticketId: 'ticket-1',
    ticketReference: '1:1197',
    ticketTitle: 'Investigate notification failures',
    objectiveId: 'obj-1'
  } as const;

  it('routes blocking question events through the waiting_on_human intent', async () => {
    const result = await emitWorkflowNotification({
      ...baseInput,
      event: {
        id: 'evt-1',
        event_type: 'question',
        is_blocking: true,
        summary: 'Need confirmation to delete files'
      }
    });

    expect(result).toMatchObject({ sent: true, intent: { kind: 'waiting_on_human' } });
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      baseInput.supabase,
      expect.objectContaining({
        organizationId: 42,
        title: 'Agent waiting: Investigate notification failures',
        body: 'Need confirmation to delete files',
        data: expect.objectContaining({
          ticketId: 'ticket-1',
          objectiveId: 'obj-1',
          eventId: 'evt-1',
          eventType: 'question',
          intent: 'waiting_on_human',
          sound: 'waiting'
        })
      })
    );
  });

  it('routes status_change review events through the ready_for_review intent', async () => {
    const result = await emitWorkflowNotification({
      ...baseInput,
      event: {
        id: 'evt-2',
        event_type: 'status_change',
        phase: 'review',
        summary: 'Delivered the orchestrator phase.'
      }
    });

    expect(result).toMatchObject({ sent: true, intent: { kind: 'ready_for_review' } });
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      baseInput.supabase,
      expect.objectContaining({
        title: 'Ready for review: Investigate notification failures',
        body: 'Delivered the orchestrator phase.',
        data: expect.objectContaining({
          eventType: 'status_change',
          intent: 'ready_for_review',
          sound: 'review'
        })
      })
    );
  });

  it('routes awaiting_approval events through the waiting_on_human intent', async () => {
    const result = await emitWorkflowNotification({
      ...baseInput,
      ticketTitle: null,
      event: {
        event_type: 'awaiting_approval',
        is_blocking: true,
        summary: 'Approve plan before continuing.'
      }
    });

    expect(result).toMatchObject({ sent: true, intent: { kind: 'waiting_on_human' } });
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      baseInput.supabase,
      expect.objectContaining({
        title: 'Approval needed (1:1197)',
        body: 'Approve plan before continuing.'
      })
    );
  });

  it('skips push when the event has no normalized intent', async () => {
    const result = await emitWorkflowNotification({
      ...baseInput,
      event: { event_type: 'update', phase: 'execute', summary: 'progress note' }
    });

    expect(result).toEqual({ sent: false, reason: 'no_intent' });
    expect(mockSendPushNotification).not.toHaveBeenCalled();
  });
});
