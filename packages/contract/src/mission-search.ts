import type { MissionSearchDateField } from './generated/api.js';
import { vocabulary } from './vocabulary.js';

// REST DTOs generated from contract/api/openapi.yaml (ADR 0006).
export type {
  MissionSearchAppliedFilters,
  MissionSearchDateField,
  MissionSearchMatchKind,
  MissionSearchResultV2,
  MissionSearchWorkspaceCount,
  SearchMissionsResponseV2
} from './generated/api.js';
/** How a v2 mission search interpreted the caller's query. */
export type MissionSearchMode = 'display_id' | 'any' | 'all' | 'phrase' | 'fallback';

/**
 * Date column used by an explicit v2 range filter.
 *
 * `dueDatetime` is how "scheduled" is expressed: a mission is scheduled by the
 * date it is due, not by an execution timer. Because the column is nullable,
 * a `dueDatetime` range excludes missions that have no due date at all, which
 * is the opposite of the created/updated columns.
 */
export const MISSION_SEARCH_DATE_FIELDS = vocabulary<MissionSearchDateField>()([
  'createdAt',
  'updatedAt',
  'dueDatetime'
]);
