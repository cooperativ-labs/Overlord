import type { ObjectiveState } from './generated/api.js';
import { vocabulary } from './vocabulary.js';

// REST DTOs generated from contract/api/openapi.yaml (ADR 0006).
export type {
  SearchAppliedFiltersV3,
  SearchMatch,
  SearchResponseV3,
  SearchResultV3
} from './generated/api.js';

/** Document kinds that may produce a returnable match. `event` always corroborates. */
export const SEARCH_RESULT_ENTITY_TYPES = ['mission', 'objective', 'delivery'] as const;

export type SearchResultEntityType = (typeof SEARCH_RESULT_ENTITY_TYPES)[number];

export const SEARCH_OBJECTIVE_STATES = vocabulary<ObjectiveState>()([
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery',
  'complete'
]);

export type SearchObjectiveState = (typeof SEARCH_OBJECTIVE_STATES)[number];

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

export interface SearchEntityCounts {
  mission: number;
  objective: number;
  delivery: number;
  event: number;
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
          'objectiveStates must be draft, submitted, launching, executing, pending_delivery, and/or complete'
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
