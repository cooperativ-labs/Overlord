/**
 * Parse human-readable Overlord ticket ids (`{organizationId}:{ticketSequence}`).
 * UUID ticket primary keys do not match this shape.
 */
export function parseTicketIdParts(
  ticketId: string
): { organizationId: number; ticketSequence: number } | null {
  const [organizationPart, ticketSequencePart, ...rest] = ticketId.trim().split(':');
  if (rest.length > 0) return null;

  const organizationId = Number.parseInt(organizationPart ?? '', 10);
  const ticketSequence = Number.parseInt(ticketSequencePart ?? '', 10);
  if (!Number.isInteger(organizationId) || organizationId <= 0) return null;
  if (!Number.isInteger(ticketSequence) || ticketSequence <= 0) return null;

  return { organizationId, ticketSequence };
}

export function organizationIdFromTicketId(ticketId: string): number | null {
  return parseTicketIdParts(ticketId)?.organizationId ?? null;
}

export function ticketSequenceFromTicketId(ticketId: string): number | null {
  return parseTicketIdParts(ticketId)?.ticketSequence ?? null;
}
