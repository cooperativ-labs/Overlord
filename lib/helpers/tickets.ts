import { collapseInlineFileMentions } from '@/lib/helpers/file-mentions';

function normalizeObjectiveForTitle(objective: string | null | undefined): string {
  return collapseInlineFileMentions((objective ?? '').trim());
}

/**
 * Returns a display title for a ticket.
 * Uses the explicit title if set, otherwise returns 'Untitled'.
 * Tickets should always have a title derived from their objective during creation.
 */
export function getDisplayTitle(ticket: { title?: string | null }): string {
  if (ticket.title?.trim()) return ticket.title.trim();
  return 'Untitled';
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
  const trimmed = normalizeObjectiveForTitle(objective);
  if (trimmed.length <= 100) return trimmed;
  return trimmed.slice(0, 100) + '…';
}
