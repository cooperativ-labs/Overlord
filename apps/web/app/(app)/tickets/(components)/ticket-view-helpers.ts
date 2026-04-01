/**
 * Shared helpers used across Board, List, and Calendar views.
 * Centralised here to prevent drift between views.
 */

/**
 * Capitalises and joins a hyphenated status slug.
 * e.g. "in-progress" -> "In Progress"
 */
export function formatStatusLabel(status: string): string {
  return status
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Extracts the last path segment from the current pathname,
 * which by convention is the ticket ID when a ticket panel is open.
 */
export function getPathTicketId(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? null;
}
