/**
 * Objective and mission reference grammar.
 *
 * This is the single source of truth for how Overlord's public identifiers are
 * spelled on the wire — `coo:756` for a mission, `coo:756.k7xm` for an
 * objective. It lives in `@overlord/contract` (no runtime dependencies) so the
 * CLI, backend, MCP server, and web app all parse the same strings the same
 * way instead of each carrying a private regex.
 *
 * `@overlord/database` re-exports these for the persistence/service layers;
 * key *generation* stays there because it is an insert-time concern.
 */

/** Crockford Base32, lowercase; omits i, l, o, u. */
export const OBJECTIVE_DISPLAY_KEY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export const OBJECTIVE_DISPLAY_KEY_LENGTH = 4;

export const OBJECTIVE_DISPLAY_ID_SEPARATOR = '.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KEY_BODY = '[0-9a-hjkmnp-tv-z]{4,5}';

const DISPLAY_ID_RE = new RegExp(`^(.+):(\\d+)\\.(${KEY_BODY})$`, 'i');

const MISSION_DISPLAY_ID_RE = /^([a-z0-9-]+):(\d+)$/i;

const WRONG_SEPARATOR_COLON_RE = new RegExp(`^(.+):(\\d+):(${KEY_BODY})$`, 'i');

const WRONG_SEPARATOR_PIPE_RE = new RegExp(`^(.+):(\\d+)\\|(${KEY_BODY})$`, 'i');

const WRONG_SEPARATOR_HYPHEN_RE = new RegExp(`^(.+):(\\d+)-(${KEY_BODY})$`, 'i');

const BARE_KEY_RE = new RegExp(`^${KEY_BODY}$`, 'i');

export type ParsedObjectiveRef =
  | { kind: 'uuid'; id: string }
  | { kind: 'display_id'; missionDisplayId: string; displayKey: string }
  | { kind: 'display_key'; displayKey: string }
  | { kind: 'mission_id'; missionDisplayId: string }
  | { kind: 'wrong_separator'; separator: ':' | '|' | '-'; ref: string }
  | { kind: 'unknown'; ref: string };

export function formatObjectiveDisplayId({
  missionDisplayId,
  displayKey
}: {
  missionDisplayId: string;
  displayKey: string;
}): string {
  return `${missionDisplayId}${OBJECTIVE_DISPLAY_ID_SEPARATOR}${displayKey}`;
}

export function parseObjectiveRef(ref: string): ParsedObjectiveRef {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return { kind: 'unknown', ref: trimmed };
  if (UUID_RE.test(trimmed)) return { kind: 'uuid', id: trimmed.toLowerCase() };

  const display = DISPLAY_ID_RE.exec(trimmed);
  if (display) {
    return {
      kind: 'display_id',
      missionDisplayId: `${display[1]}:${display[2]}`,
      displayKey: display[3]!.toLowerCase()
    };
  }

  if (WRONG_SEPARATOR_COLON_RE.test(trimmed)) {
    return { kind: 'wrong_separator', separator: ':', ref: trimmed };
  }
  if (WRONG_SEPARATOR_PIPE_RE.test(trimmed)) {
    return { kind: 'wrong_separator', separator: '|', ref: trimmed };
  }
  if (WRONG_SEPARATOR_HYPHEN_RE.test(trimmed)) {
    return { kind: 'wrong_separator', separator: '-', ref: trimmed };
  }

  if (MISSION_DISPLAY_ID_RE.test(trimmed)) {
    return { kind: 'mission_id', missionDisplayId: trimmed };
  }

  if (BARE_KEY_RE.test(trimmed)) {
    return { kind: 'display_key', displayKey: trimmed.toLowerCase() };
  }

  return { kind: 'unknown', ref: trimmed };
}

/**
 * The parent mission display id carried inside an objective display id, or
 * `null` when the reference is anything else (a UUID, a bare key, a mission id,
 * or a malformed string).
 *
 * This is what lets every surface accept `--objective-id coo:756.k7xm` without
 * a separate `--mission-id`: the objective display id already names its mission,
 * so callers holding only the objective reference never have to reconstruct one.
 * A UUID carries no such parent, which is why UUID callers still need the
 * mission — or a server round trip — to resolve scope.
 */
export function missionDisplayIdFromObjectiveRef(ref: string | null | undefined): string | null {
  if (typeof ref !== 'string' || ref.trim() === '') return null;
  const parsed = parseObjectiveRef(ref);
  return parsed.kind === 'display_id' ? parsed.missionDisplayId : null;
}
