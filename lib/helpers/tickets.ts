/**
 * Returns a display title for a ticket.
 * Uses the explicit title if set, otherwise falls back to the first 60 characters
 * of the objective (description). This lets users skip the title field on creation
 * while still having a readable label on cards and lists.
 */
export function getDisplayTitle(ticket: {
  title?: string | null;
  objective?: string | null;
}): string {
  if (ticket.title?.trim()) return ticket.title.trim();
  const text = (ticket.objective ?? '').trim();
  if (!text) return 'Untitled';
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

export function getTicketIdentifier(ticketId: string): string {
  if (!ticketId) return '';
  return ticketId.slice(-8);
}

/**
 * Derives a short title from an objective string.
 * Truncates to 60 characters with an ellipsis if needed.
 */
export function deriveTitleFromObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 60) + '…';
}
