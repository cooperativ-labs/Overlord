import type {
  MissionSearchAppliedFilters,
  MissionSearchMatchKind,
  MissionSearchResultV2,
  MissionSearchWorkspaceCount
} from './mission-search.js';

/** Document kinds that can be returned as a child match. `event` is never returnable. */
export const SEARCH_MATCH_ENTITY_TYPES = ['objective', 'delivery'] as const;

export type SearchMatchEntityType = (typeof SEARCH_MATCH_ENTITY_TYPES)[number];

/** Document kinds that may produce a returnable match. `event` always corroborates. */
export const SEARCH_RESULT_ENTITY_TYPES = ['mission', 'objective', 'delivery'] as const;

export type SearchResultEntityType = (typeof SEARCH_RESULT_ENTITY_TYPES)[number];

export const SEARCH_OBJECTIVE_STATES = [
  'future',
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery',
  'complete'
] as const;

export type SearchObjectiveState = (typeof SEARCH_OBJECTIVE_STATES)[number];

/** Widened from MissionSearchMatchKind. */
export type SearchMatchKind = MissionSearchMatchKind;

export const DEFAULT_SEARCH_ENTITY_TYPES: SearchResultEntityType[] = [
  'mission',
  'objective',
  'delivery'
];

export const DEFAULT_MATCHES_PER_RESULT = 3;

export const MAX_MATCHES_PER_RESULT = 10;

/** Per-workspace matching-document fetch cap for v3 retrieval. */
export const SEARCH_CANDIDATE_FETCH_LIMIT = 500;

/** Child score = docScore + CONTEXT_WEIGHT * missionScore. */
export const SEARCH_CHILD_CONTEXT_WEIGHT = 0.15;

export interface SearchMatch {
  entityType: SearchMatchEntityType;
  id: string;
  /** `coo:789.2nnh` for objectives; null for deliveries. */
  displayId: string | null;
  /** Objective title, or the delivery's first line. */
  title: string;
  /** Owning objective. Set for objectives (self) and for the objective a delivery closed. */
  objectiveId: string | null;
  /** ObjectiveState for objectives; null otherwise. */
  objectiveState: string | null;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultV3 extends MissionSearchResultV2 {
  /** True when nothing on the mission record itself matched — it anchors children only. */
  anchorOnly: boolean;
  /** Ranked, capped by `matchesPerResult`. */
  matches: SearchMatch[];
  /** Matching document counts for this mission, BEFORE `matchesPerResult` capping. */
  matchCounts: {
    objective: number;
    delivery: number;
    event: number;
  };
}

export interface SearchAppliedFiltersV3 extends MissionSearchAppliedFilters {
  entityTypes: SearchResultEntityType[];
  objectiveStates: SearchObjectiveState[];
  matchesPerResult: number;
}

export interface SearchEntityCounts {
  mission: number;
  objective: number;
  delivery: number;
  event: number;
}

export interface SearchResponseV3 {
  version: 3;
  results: SearchResultV3[];
  appliedFilters: SearchAppliedFiltersV3;
  /** Mission groups matched before `limit`. Same meaning as v2. */
  totalMatchedBeforeLimit: number;
  /** Matching documents by type across eligible missions, before mission/child caps. */
  entityCounts: SearchEntityCounts;
  workspaceCounts: MissionSearchWorkspaceCount[];
  /** True when the per-workspace candidate cap was hit; counts above are lower bounds. */
  truncatedCandidates: boolean;
}

export type SearchParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function uniquePreserve<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function parseSearchEntityTypes(
  values: readonly string[] | null | undefined
): SearchParseResult<SearchResultEntityType[]> {
  if (!values || values.length === 0) {
    return { ok: true, value: [...DEFAULT_SEARCH_ENTITY_TYPES] };
  }
  const parsed: SearchResultEntityType[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    if (value === 'event') {
      return {
        ok: false,
        error:
          'entityTypes does not accept event; events always corroborate and are never returnable'
      };
    }
    if (value !== 'mission' && value !== 'objective' && value !== 'delivery') {
      return {
        ok: false,
        error: 'entityTypes must be mission, objective, and/or delivery'
      };
    }
    parsed.push(value);
  }
  if (parsed.length === 0) {
    return { ok: true, value: [...DEFAULT_SEARCH_ENTITY_TYPES] };
  }
  return { ok: true, value: uniquePreserve(parsed) };
}

export function parseSearchObjectiveStates(
  values: readonly string[] | null | undefined
): SearchParseResult<SearchObjectiveState[]> {
  if (!values || values.length === 0) {
    return { ok: true, value: [] };
  }
  const parsed: SearchObjectiveState[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    if (!SEARCH_OBJECTIVE_STATES.includes(value as SearchObjectiveState)) {
      return {
        ok: false,
        error:
          'objectiveStates must be future, draft, submitted, launching, executing, pending_delivery, and/or complete'
      };
    }
    parsed.push(value as SearchObjectiveState);
  }
  return { ok: true, value: uniquePreserve(parsed) };
}

export function parseMatchesPerResult(
  value: number | string | null | undefined
): SearchParseResult<number> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: DEFAULT_MATCHES_PER_RESULT };
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false, error: 'matchesPerResult must be an integer between 1 and 10' };
  }
  if (parsed < 1 || parsed > MAX_MATCHES_PER_RESULT) {
    return { ok: false, error: 'matchesPerResult must be an integer between 1 and 10' };
  }
  return { ok: true, value: parsed };
}

export function isSearchMatchEntityType(value: string): value is SearchMatchEntityType {
  return value === 'objective' || value === 'delivery';
}
