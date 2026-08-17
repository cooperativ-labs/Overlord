import type { DatabaseClient } from '@overlord/database';
import { generateObjectiveDisplayKey, OBJECTIVE_DISPLAY_KEY_LENGTH } from '@overlord/database';

import { ServiceError } from './errors.js';

export {
  formatObjectiveDisplayId,
  generateObjectiveDisplayKey,
  OBJECTIVE_DISPLAY_ID_SEPARATOR,
  OBJECTIVE_DISPLAY_KEY_ALPHABET,
  OBJECTIVE_DISPLAY_KEY_LENGTH,
  type ParsedObjectiveRef,
  parseObjectiveRef
} from '@overlord/database';

const ALLOCATE_ATTEMPTS = 8;

export async function allocateObjectiveDisplayKey({
  db,
  missionId,
  generate = generateObjectiveDisplayKey
}: {
  db: DatabaseClient;
  missionId: string;
  generate?: typeof generateObjectiveDisplayKey;
}): Promise<string> {
  for (const length of [OBJECTIVE_DISPLAY_KEY_LENGTH, OBJECTIVE_DISPLAY_KEY_LENGTH + 1]) {
    for (let attempt = 0; attempt < ALLOCATE_ATTEMPTS; attempt += 1) {
      const key = generate({ length });
      const existing = await db.get<{ id: string }>(
        `SELECT id FROM objectives
           WHERE mission_id = ? AND display_key = ? AND deleted_at IS NULL`,
        [missionId, key]
      );
      if (!existing) return key;
    }
  }
  throw new ServiceError(
    'Could not allocate an objective display key',
    'display_key_exhausted',
    500
  );
}
