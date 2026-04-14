export const TICKET_DELETED_EVENT = 'overlord:ticket-deleted';

export type TicketDeletedEventDetail = {
  ticketId: string;
};

export function dispatchTicketDeletedEvent(ticketId: string) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<TicketDeletedEventDetail>(TICKET_DELETED_EVENT, {
      detail: { ticketId }
    })
  );
}
