import { randomBytes } from 'node:crypto';

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

export function generateObjectiveDisplayKey({
  length = OBJECTIVE_DISPLAY_KEY_LENGTH,
  bytes = randomBytes
}: {
  length?: number;
  bytes?: (size: number) => Buffer;
} = {}): string {
  const alphabet = OBJECTIVE_DISPLAY_KEY_ALPHABET;
  const raw = bytes(length);
  let key = '';
  for (let index = 0; index < length; index += 1) {
    key += alphabet[(raw[index] ?? 0) % alphabet.length];
  }
  return key;
}

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
