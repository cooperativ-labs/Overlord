/** Narrowing helpers for untrusted JSON (hook payloads, app-server frames, API responses). */

/** The value as a plain object, or null for primitives, null and arrays. */
export function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The value as a plain object, or `{}` for primitives, null and arrays. */
export function asRecord(value: unknown): Record<string, unknown> {
  return asRecordOrNull(value) ?? {};
}
