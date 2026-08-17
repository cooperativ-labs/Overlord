const TITLE_MAX_LENGTH = 80;

/**
 * Shared with the standard push dispatcher (coo:444): these two functions are the
 * only path by which user-authored text reaches any APNs payload, so both push
 * surfaces bound and strip through exactly one implementation. They live in their
 * own module — free of database imports — so presentation helpers built on them
 * stay unit-testable without opening a database.
 */
export function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function presentationTitle(value: string): string {
  return bounded(
    value
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/^[#>\-+*]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim(),
    TITLE_MAX_LENGTH
  );
}
