/** Narrowing helpers for stored JSON columns (`metadata_json`, `details_json`, `settings_json`). */

/** The value as a plain object, or `{}` for primitives, null and arrays. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Parse a JSON object column; malformed JSON, arrays and primitives all read as `{}`. */
export function parseMetadataJson(json: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(json) as unknown);
  } catch {
    return {};
  }
}
