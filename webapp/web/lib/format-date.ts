type RelativeTimeOptions = {
  missing?: string;
  invalid?: string;
  immediate?: string;
  rounding?: 'round' | 'floor';
};

function parsedDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Human-readable date, or an em-dash when absent or invalid. */
export function formatDate(iso: string | null | undefined): string {
  const date = parsedDate(iso);
  if (!date) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Human-readable date and time, or an em-dash when absent or invalid. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parsedDate(iso);
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/** Locale date and time, preserving a non-empty raw value when it is invalid. */
export function formatTimestamp(iso: string): string {
  const date = parsedDate(iso);
  return date ? date.toLocaleString() : iso;
}

/** Compact elapsed-time label, rendered against an explicit clock. */
export function relativeTime(
  iso: string | null | undefined,
  nowIso: string,
  options: RelativeTimeOptions = {}
): string {
  if (!iso) return options.missing ?? '';
  const then = parsedDate(iso)?.getTime();
  const now = parsedDate(nowIso)?.getTime();
  if (then === undefined || now === undefined) return options.invalid ?? '';
  const round = options.rounding === 'floor' ? Math.floor : Math.round;
  const seconds = Math.max(0, round((now - then) / 1000));
  if (seconds < 60) return options.immediate ?? `${seconds}s ago`;
  const minutes = round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${round(hours / 24)}d ago`;
}
