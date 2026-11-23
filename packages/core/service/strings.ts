/**
 * Dependency-free string helpers. Kept apart from `util.ts` (which needs `node:crypto` and the
 * database types) so that pure modules such as `terminal-profile-types.ts`, which the CLI also
 * bundles, can share them.
 */

/** The trimmed string, or null for blanks and non-strings. */
export function trimmedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
