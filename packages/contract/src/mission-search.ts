/** How a v2 mission search interpreted the caller's query. */
export type MissionSearchMode = 'display_id' | 'any' | 'all' | 'phrase' | 'fallback';

/** Where a result matched the query. */
export type MissionSearchMatchKind =
  | 'title'
  | 'displayId'
  | 'objective'
  | 'event'
  | 'delivery'
  | 'constraints'
  | 'notes';

/**
 * Date column used by an explicit v2 range filter.
 *
 * `dueDatetime` is how "scheduled" is expressed: a mission is scheduled by the
 * date it is due, not by an execution timer. Because the column is nullable,
 * a `dueDatetime` range excludes missions that have no due date at all, which
 * is the opposite of the created/updated columns.
 */
export type MissionSearchDateField = 'createdAt' | 'updatedAt' | 'dueDatetime';

/**
 * Filters that actually constrained a v2 search. Omitted or empty fields were
 * not applied. There is never an implicit date window.
 */
export interface MissionSearchAppliedFilters {
  query: string | null;
  mode: MissionSearchMode;
  projectIds: string[];
  resourceKeys: string[];
  statusTypes: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  /** Distinct meaningful-term coverage required in default `any` mode. */
  coverageFloor: number | null;
}

export interface MissionSearchWorkspaceCount {
  workspaceId: string;
  matched: number;
  returned: number;
}

export interface MissionSearchResultV2 {
  id: string;
  displayId: string;
  title: string;
  statusType: string;
  statusId: string;
  priority: string | null;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  createdAt: string;
  updatedAt: string;
  /** When the mission is due. Null when it has never been scheduled. */
  dueDatetime: string | null;
  objectiveCount: number;
  /**
   * Deterministic fused ranking score (text rank fused with recency, with
   * exact display-id / exact-title precedence). Not a raw bm25/ts_rank value.
   */
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  matchedIn: MissionSearchMatchKind[];
}

/**
 * Versioned mission-search envelope. `GET /api/missions/search` remains the
 * frozen v1 array-shaped response; this is `GET /api/missions/search/v2`.
 */
export interface SearchMissionsResponseV2 {
  version: 2;
  results: MissionSearchResultV2[];
  appliedFilters: MissionSearchAppliedFilters;
  totalMatchedBeforeLimit: number;
  workspaceCounts: MissionSearchWorkspaceCount[];
}
