import { OBJECTIVE_DISPLAY_KEY_ALPHABET, OBJECTIVE_DISPLAY_KEY_LENGTH } from '@overlord/contract';
import { randomBytes } from 'node:crypto';

/**
 * The objective/mission reference *grammar* lives in `@overlord/contract`
 * (`packages/contract/src/objective-ref.ts`) so the CLI and MCP server can parse
 * `coo:756.k7xm` without pulling in the persistence layer. This module re-exports
 * it for the service/repository layers that already import from
 * `@overlord/database`, and owns the one piece that is genuinely persistence
 * concern: minting a new key at insert time.
 */
export {
  formatObjectiveDisplayId,
  missionDisplayIdFromObjectiveRef,
  OBJECTIVE_DISPLAY_ID_SEPARATOR,
  OBJECTIVE_DISPLAY_KEY_ALPHABET,
  OBJECTIVE_DISPLAY_KEY_LENGTH,
  type ParsedObjectiveRef,
  parseObjectiveRef
} from '@overlord/contract';

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
