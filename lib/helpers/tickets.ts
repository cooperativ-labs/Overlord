import { collapseInlineFileMentions } from '@/lib/helpers/file-mentions';

function normalizeObjectiveForTitle(objective: string | null | undefined): string {
  return collapseInlineFileMentions((objective ?? '').trim());
}

type TicketReferenceInput =
  | string
  | {
      id?: string | null;
      ticket_id?: string | null;
      ticket_sequence?: number | null;
    };

/**
 * Returns a display title for a ticket.
 * Uses the explicit title if set, otherwise returns 'Untitled'.
 * Tickets should always have a title derived from their objective during creation.
 */
export function getDisplayTitle(ticket: { title?: string | null }): string {
  if (ticket.title?.trim()) return ticket.title.trim();
  return 'Untitled';
}

export function getTicketIdentifier(ticket: TicketReferenceInput): string {
  if (typeof ticket === 'string') {
    return ticket ? ticket.slice(-8) : '';
  }

  const persistedIdentifier = ticket.ticket_id?.trim();
  if (persistedIdentifier) return persistedIdentifier;

  if (typeof ticket.ticket_sequence === 'number' && Number.isFinite(ticket.ticket_sequence)) {
    return String(ticket.ticket_sequence);
  }

  const fallbackId = ticket.id?.trim();
  return fallbackId ? fallbackId.slice(-8) : '';
}

/**
 * Derives a short title from an objective string.
 * Truncates to 100 characters with an ellipsis if needed.
 */
export function deriveTitleFromObjective(objective: string): string {
  const trimmed = normalizeObjectiveForTitle(objective);
  if (trimmed.length <= 100) return trimmed;
  return trimmed.slice(0, 100) + '…';
}

export function hasNonEmptyObjectiveText(objective: string | null | undefined): boolean {
  return (objective ?? '').trim().length > 0;
}

export function isDraftObjectiveWithText(objective: {
  state: string | null | undefined;
  objective: string | null | undefined;
}): boolean {
  return objective.state === 'draft' && hasNonEmptyObjectiveText(objective.objective);
}
