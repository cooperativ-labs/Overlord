import { resolveCreateTimeRecordTaskId } from '@/lib/actions/everhour';

describe('resolveCreateTimeRecordTaskId', () => {
  it('uses ticket stored task id when available', async () => {
    const getTicketState = jest.fn().mockResolvedValue({ everhour_task_id: 'task-stored' });
    const ensureTaskForTicket = jest.fn();

    await expect(
      resolveCreateTimeRecordTaskId(
        { everhourTaskId: 'task-explicit', ticketId: 'ticket-1' },
        { ensureTaskForTicket, getTicketState }
      )
    ).resolves.toBe('task-stored');

    expect(getTicketState).toHaveBeenCalledWith('ticket-1');
    expect(ensureTaskForTicket).not.toHaveBeenCalled();
  });

  it('provisions a ticket task when missing', async () => {
    const getTicketState = jest.fn().mockResolvedValue({ everhour_task_id: null });
    const ensureTaskForTicket = jest.fn().mockResolvedValue({ taskId: 'task-created' });

    await expect(
      resolveCreateTimeRecordTaskId(
        { ticketId: 'ticket-2' },
        { ensureTaskForTicket, getTicketState }
      )
    ).resolves.toBe('task-created');

    expect(getTicketState).toHaveBeenCalledWith('ticket-2');
    expect(ensureTaskForTicket).toHaveBeenCalledWith('ticket-2');
  });

  it('uses explicit task id when no ticket context exists', async () => {
    const getTicketState = jest.fn();
    const ensureTaskForTicket = jest.fn();

    await expect(
      resolveCreateTimeRecordTaskId(
        { everhourTaskId: 'task-explicit' },
        { ensureTaskForTicket, getTicketState }
      )
    ).resolves.toBe('task-explicit');

    expect(getTicketState).not.toHaveBeenCalled();
    expect(ensureTaskForTicket).not.toHaveBeenCalled();
  });
});
