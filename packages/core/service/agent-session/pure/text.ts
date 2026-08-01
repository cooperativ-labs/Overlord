/**
 * Text handling for the agent-session description layer.
 *
 * Everything a formatter emits is derived from model-controlled input, so the rules here are
 * security rules rather than presentation preferences:
 *
 *  - **Control characters are escaped, never passed through.** A tool input containing a
 *    newline followed by spaces can make a destructive command's card read as two innocuous
 *    lines. Escaping is what keeps one field one line.
 *  - **Truncation is explicit.** A silently clipped command reads as complete, and a user who
 *    approves what they believe is the whole command has been misled by us, not by the model.
 *  - **Non-ASCII in a path is a flag, not a failure.** Homoglyph attacks (`ѕrc/` with a
 *    Cyrillic `s`) render identically to the real path. We cannot reject them — real projects
 *    have non-ASCII filenames — so we surface the fact rather than hide it.
 */

/** Longest single field a formatter may emit before truncation kicks in. */
export const MAX_FIELD_LENGTH = 300;

/** Longest command text rendered on a card. Shorter than a field: nobody audits 300 chars. */
export const MAX_COMMAND_LENGTH = 200;

// C0 (even tab and newline are escaped), DEL, and the C1 range.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

const BIDI_CONTROL_PATTERN = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\u0000': '\\0'
};

/**
 * Render arbitrary text as a single safe line.
 *
 * Bidirectional overrides are removed rather than escaped: unlike a newline, there is no
 * legitimate reason for one to appear in a tool argument, and leaving even an escaped form in
 * place invites a renderer somewhere downstream to interpret it.
 */
export function escapeControlCharacters(value: string): string {
  return value
    .replace(BIDI_CONTROL_PATTERN, '')
    .replace(
      CONTROL_CHARACTER_PATTERN,
      char => ESCAPES[char] ?? `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`
    );
}

export type TruncatedText = { text: string; truncated: boolean };

/**
 * Truncate to `max` characters, marking the cut explicitly.
 *
 * The marker states how much was dropped. "…" alone tells a reader that something is missing
 * but not whether it was three characters or three thousand, and that difference is exactly
 * what decides whether the remainder is worth trusting.
 */
export function truncate(value: string, max: number = MAX_FIELD_LENGTH): TruncatedText {
  if (value.length <= max) return { text: value, truncated: false };
  const dropped = value.length - max;
  return { text: `${value.slice(0, max)}…[+${dropped} chars]`, truncated: true };
}

/** Escape, collapse runs of whitespace, and truncate — the standard path for any free text. */
export function safeText(value: unknown, max: number = MAX_FIELD_LENGTH): TruncatedText {
  if (typeof value !== 'string') return { text: '', truncated: false };
  const collapsed = escapeControlCharacters(value).replace(/\s+/g, ' ').trim();
  return truncate(collapsed, max);
}

/** True when the string contains characters outside printable ASCII. */
export function hasNonAscii(value: string): boolean {
  return /[^\x20-\x7E]/.test(value);
}
