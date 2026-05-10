export const TICKET_DELETED_EVENT = 'overlord:ticket-deleted';
export const TICKET_CREATED_EVENT = 'overlord:ticket-created';
export const TICKET_CREATED_STORAGE_KEY = 'overlord:ticket-created';

export type TicketDeletedEventDetail = {
  ticketId: string;
};

export type TicketCreatedEventDetail = {
  ticketId: string;
  organizationId: number;
  projectId: string | null;
};

export function dispatchTicketDeletedEvent(ticketId: string) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<TicketDeletedEventDetail>(TICKET_DELETED_EVENT, {
      detail: { ticketId }
    })
  );
}

export function dispatchTicketCreatedEvent(detail: TicketCreatedEventDetail) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<TicketCreatedEventDetail>(TICKET_CREATED_EVENT, {
      detail
    })
  );

  try {
    window.localStorage.setItem(
      TICKET_CREATED_STORAGE_KEY,
      JSON.stringify({
        ...detail,
        emittedAt: Date.now()
      })
    );
  } catch {
    // Ignore storage write failures. The same-window custom event still fires.
  }
}
