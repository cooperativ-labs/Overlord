import type {
  MissionSearchAppliedFilters,
  MissionSearchDateField,
  MissionSearchMatchKind,
  MissionSearchResultV2,
  SearchAppliedFiltersV3,
  SearchEntityCounts,
  SearchMatch,
  SearchMissionsResponseV2,
  SearchObjectiveState,
  SearchResponseV3,
  SearchResultEntityType,
  SearchResultV3
} from '@overlord/contract';
import {
  DEFAULT_SEARCH_ENTITY_TYPES,
  parseMatchesPerResult,
  parseSearchEntityTypes,
  parseSearchObjectiveStates,
  SEARCH_CANDIDATE_FETCH_LIMIT,
  SEARCH_CHILD_CONTEXT_WEIGHT
} from '@overlord/contract';
import { type DatabaseClient, formatObjectiveDisplayId } from '@overlord/database';

import { ServiceError } from './errors.js';
import { type ParsedMissionSearchQuery, parseMissionSearchQuery } from './mission-search-query.js';
import {
  buildMissionSearchMatch,
  missionSearchDocBodyColumn,
  missionSearchDocBodyColumnV3,
  missionSearchDocScoreExpr,
  missionSearchDocScoreExprForWeights,
  missionSearchDocTitleColumn,
  missionSearchDocTitleColumnV3,
  missionSearchEntityIdColumnV3,
  missionSearchEntityTypeColumn,
  missionSearchEntityTypeColumnV3,
  missionSearchFromClause,
  missionSearchFromClauseV3,
  missionSearchMatchPredicate,
  missionSearchMissionIdColumn,
  missionSearchMissionIdColumnV3,
  missionSearchWorkspaceParams
} from './mission-search-sql.js';

const CORROBORATION_WEIGHT = 0.1;
const RANK_FUSION_OFFSET = 60;
const RECENCY_FUSION_WEIGHT = 0.15;
const SNIPPET_MAX_LENGTH = 160;
const EXACT_DISPLAY_ID_BOOST = 2;
const EXACT_TITLE_BOOST = 1;
const TITLE_MATCH_BOOST = 0.5;
const ISO_DATE_BOUND_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type RankedMissionHit = {
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
  dueDatetime: string | null;
  objectiveCount: number;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  matchedIn: MissionSearchMatchKind[];
};

export type WorkspaceMissionSearch = {
  parsed: ParsedMissionSearchQuery;
  hits: RankedMissionHit[];
  totalMatchedBeforeLimit: number;
  appliedFilters: MissionSearchAppliedFilters;
  workspaceCounts: Array<{ workspaceId: string; matched: number; returned: number }>;
};

function validateDateBound(name: 'from' | 'to', value: string | null | undefined): void {
  if (!value) return;
  if (!ISO_DATE_BOUND_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ServiceError(`${name} must be an ISO-8601 timestamp`, 'validation_error');
  }
}

type SearchDocumentRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  display_id: string;
  title: string;
  status_type: string;
  status_id: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
  due_datetime: string | null;
  objective_count: number;
  project_name: string;
  workspace_name: string;
  workspace_slug: string;
  doc_title: string | null;
  doc_body: string | null;
  entity_type: string | null;
  doc_score: number;
};

type MissionLabelRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  display_id: string;
  title: string;
  status_type: string;
  status_id: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
  due_datetime: string | null;
  objective_count: number;
  project_name: string;
  workspace_name: string;
  workspace_slug: string;
};

function missionSelectColumns({ includeSearchFields = false } = {}): string {
  const extras = includeSearchFields
    ? `, t.constraints_text, t.output_format_text, t.notes_text`
    : '';
  return `t.id, t.workspace_id, t.project_id, t.display_id, t.title,
          t.status_type, t.status_id, t.priority, t.created_at, t.updated_at,
          t.due_datetime${extras},
          (SELECT COUNT(*) FROM objectives o
             WHERE o.mission_id = t.id AND o.deleted_at IS NULL) AS objective_count,
          p.name AS project_name, w.name AS workspace_name, w.slug AS workspace_slug`;
}

function projectAndStatusSql({
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to
}: {
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
}): { sql: string; params: string[] } {
  const params: string[] = [];
  let sql = '';
  if (projectIds.length > 0) {
    sql += ` AND t.project_id IN (${projectIds.map(() => '?').join(', ')})`;
    params.push(...projectIds);
  }
  if (statusTypes.length > 0) {
    sql += ` AND t.status_type IN (${statusTypes.map(() => '?').join(', ')})`;
    params.push(...statusTypes);
  }
  if (resourceKeys.length > 0) {
    sql += ` AND EXISTS (
      SELECT 1 FROM objectives o
       WHERE o.mission_id = t.id AND o.deleted_at IS NULL
         AND o.resource_key IN (${resourceKeys.map(() => '?').join(', ')})
    )`;
    params.push(...resourceKeys);
  }
  const dateColumn =
    dateField === 'createdAt'
      ? 't.created_at'
      : dateField === 'dueDatetime'
        ? 't.due_datetime'
        : 't.updated_at';
  // `due_datetime` is nullable, so a due-date range is a question about
  // scheduled missions only. NULL never satisfies a comparison, which excludes
  // unscheduled missions exactly as intended — but only once a bound exists,
  // so naming the field without bounds stays a no-op like the other columns.
  if (from) {
    sql += ` AND ${dateColumn} >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND ${dateColumn} < ?`;
    params.push(to);
  }
  return { sql, params };
}

function termMatchesHaystack({ term, haystack }: { term: string; haystack: string }): boolean {
  return haystack.toLowerCase().includes(term.toLowerCase());
}

function matchedTermsInText({ terms, text }: { terms: string[]; text: string }): string[] {
  return terms.filter(term => termMatchesHaystack({ term, haystack: text }));
}

function snippetAroundTerms({ text, terms }: { text: string; terms: string[] }): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  let idx = -1;
  let matchedLen = 0;
  for (const term of terms) {
    const at = lower.indexOf(term.toLowerCase());
    if (at === -1) continue;
    if (idx === -1 || at < idx) {
      idx = at;
      matchedLen = term.length;
    }
  }
  if (idx === -1) {
    if (trimmed.length <= SNIPPET_MAX_LENGTH) return trimmed;
    return `${trimmed.slice(0, SNIPPET_MAX_LENGTH).trimEnd()}…`;
  }
  const padding = Math.max(0, Math.floor((SNIPPET_MAX_LENGTH - matchedLen) / 2));
  let start = Math.max(0, idx - padding);
  let end = Math.min(trimmed.length, start + SNIPPET_MAX_LENGTH);
  if (end - start < SNIPPET_MAX_LENGTH) start = Math.max(0, end - SNIPPET_MAX_LENGTH);
  let snippet = trimmed.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < trimmed.length) snippet = `${snippet}…`;
  return snippet;
}

function aggregateDocumentScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const max = Math.max(...scores);
  const others = Math.max(0, scores.length - 1);
  return max + CORROBORATION_WEIGHT * Math.log(1 + others);
}

function fusedRankScore({
  textRank,
  recencyRank
}: {
  textRank: number;
  recencyRank: number;
}): number {
  return (
    1 / (RANK_FUSION_OFFSET + textRank) + RECENCY_FUSION_WEIGHT / (RANK_FUSION_OFFSET + recencyRank)
  );
}

function publicRelevance({
  exactDisplayId,
  exactTitle,
  titleMatch,
  fused
}: {
  exactDisplayId: boolean;
  exactTitle: boolean;
  titleMatch: boolean;
  fused: number;
}): number {
  const precedence = exactDisplayId
    ? EXACT_DISPLAY_ID_BOOST
    : exactTitle
      ? EXACT_TITLE_BOOST
      : titleMatch
        ? TITLE_MATCH_BOOST
        : 0;
  return precedence + fused;
}

function toHitFromRow({
  row,
  relevance,
  snippet,
  matchedTerms,
  matchedIn
}: {
  row: MissionLabelRow;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  matchedIn: MissionSearchMatchKind[];
}): RankedMissionHit {
  return {
    id: row.id,
    displayId: row.display_id,
    title: row.title,
    statusType: row.status_type,
    statusId: row.status_id,
    priority: row.priority,
    projectId: row.project_id,
    projectName: row.project_name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueDatetime: row.due_datetime,
    objectiveCount: Number(row.objective_count) || 0,
    relevance,
    snippet,
    matchedTerms,
    matchedIn
  };
}

function buildAppliedFilters({
  parsed,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to
}: {
  parsed: ParsedMissionSearchQuery;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
}): MissionSearchAppliedFilters {
  return {
    query: parsed.raw || null,
    mode: parsed.mode,
    projectIds,
    resourceKeys,
    statusTypes,
    dateField,
    from,
    to,
    coverageFloor: parsed.coverageFloor
  };
}

function envelope({
  parsed,
  hits,
  totalMatchedBeforeLimit,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  workspaceId
}: {
  parsed: ParsedMissionSearchQuery;
  hits: RankedMissionHit[];
  totalMatchedBeforeLimit: number;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  workspaceId: string;
}): WorkspaceMissionSearch {
  return {
    parsed,
    hits,
    totalMatchedBeforeLimit,
    appliedFilters: buildAppliedFilters({
      parsed,
      projectIds,
      statusTypes,
      resourceKeys,
      dateField,
      from,
      to
    }),
    workspaceCounts: [{ workspaceId, matched: totalMatchedBeforeLimit, returned: hits.length }]
  };
}

async function listFallbackMissions({
  db,
  workspaceId,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit
}: {
  db: DatabaseClient;
  workspaceId: string;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  limit: number;
}): Promise<{ rows: MissionLabelRow[]; total: number }> {
  const filters = projectAndStatusSql({
    projectIds,
    statusTypes,
    resourceKeys,
    dateField,
    from,
    to
  });
  const countRow = (await db.get(
    `SELECT COUNT(*) AS total
       FROM missions t
      WHERE t.workspace_id = ? AND t.deleted_at IS NULL${filters.sql}`,
    [workspaceId, ...filters.params]
  )) as { total: number };
  const rows = (await db.all(
    `SELECT ${missionSelectColumns()}
       FROM missions t
       JOIN projects p ON p.id = t.project_id
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.workspace_id = ? AND t.deleted_at IS NULL${filters.sql}
      ORDER BY t.updated_at DESC
      LIMIT ?`,
    [workspaceId, ...filters.params, limit]
  )) as MissionLabelRow[];
  return { rows, total: Number(countRow.total) || 0 };
}

async function lookupDisplayId({
  db,
  workspaceId,
  displayId,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to
}: {
  db: DatabaseClient;
  workspaceId: string;
  displayId: string;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
}): Promise<MissionLabelRow | undefined> {
  const filters = projectAndStatusSql({
    projectIds,
    statusTypes,
    resourceKeys,
    dateField,
    from,
    to
  });
  return (await db.get(
    `SELECT ${missionSelectColumns()}
       FROM missions t
       JOIN projects p ON p.id = t.project_id
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.workspace_id = ? AND t.deleted_at IS NULL
        AND lower(t.display_id) = lower(?)${filters.sql}`,
    [workspaceId, displayId, ...filters.params]
  )) as MissionLabelRow | undefined;
}

/**
 * Portable per-workspace mission search. Applies display-id short-circuit, the
 * term-coverage floor, MAX-plus-bounded-corroboration aggregation, and bounded
 * recency rank fusion. Does not fan out across workspaces.
 */
export async function searchWorkspaceMissions({
  db,
  workspaceId,
  query,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25
}: {
  db: DatabaseClient;
  workspaceId: string;
  query?: string | null;
  projectIds?: string[] | null;
  statusTypes?: string[] | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<WorkspaceMissionSearch> {
  const parsed = parseMissionSearchQuery(query ?? '');
  const projects = projectIds?.filter(id => id.trim() !== '') ?? [];
  const types = statusTypes?.filter(type => type.trim() !== '') ?? [];
  const resources = resourceKeys?.filter(key => key.trim() !== '') ?? [];
  const boundsPresent = Boolean(from || to);
  const date = dateField ?? (boundsPresent ? 'updatedAt' : null);
  if (date !== null && date !== 'createdAt' && date !== 'updatedAt' && date !== 'dueDatetime') {
    throw new ServiceError(
      'dateField must be createdAt, updatedAt, or dueDatetime',
      'validation_error'
    );
  }
  validateDateBound('from', from);
  validateDateBound('to', to);
  if (from && to && Date.parse(from) >= Date.parse(to)) {
    throw new ServiceError('from must be earlier than to', 'validation_error');
  }
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 25;

  if (parsed.mode === 'fallback') {
    const { rows, total } = await listFallbackMissions({
      db,
      workspaceId,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      limit: cappedLimit
    });
    const hits = rows.map(row =>
      toHitFromRow({
        row,
        relevance: 0,
        snippet: null,
        matchedTerms: [],
        matchedIn: []
      })
    );
    return envelope({
      parsed,
      hits,
      totalMatchedBeforeLimit: total,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      workspaceId
    });
  }

  if (parsed.mode === 'display_id' && parsed.displayId) {
    const row = await lookupDisplayId({
      db,
      workspaceId,
      displayId: parsed.displayId,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null
    });
    const hits = row
      ? [
          toHitFromRow({
            row,
            relevance: publicRelevance({
              exactDisplayId: true,
              exactTitle: false,
              titleMatch: false,
              fused: 1
            }),
            snippet: row.title,
            matchedTerms: [parsed.displayId],
            matchedIn: ['displayId']
          })
        ]
      : [];
    return envelope({
      parsed,
      hits,
      totalMatchedBeforeLimit: hits.length,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      workspaceId
    });
  }

  const match = buildMissionSearchMatch({ dialect: db.dialect, terms: parsed.terms });
  if (!match) {
    return searchWorkspaceMissions({
      db,
      workspaceId,
      query: '',
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      limit: cappedLimit
    });
  }

  const filters = projectAndStatusSql({
    projectIds: projects,
    statusTypes: types,
    resourceKeys: resources,
    dateField: date,
    from: from ?? null,
    to: to ?? null
  });
  const dialect = db.dialect;
  const rows = (await db.all(
    `SELECT ${missionSelectColumns()},
            ${missionSearchDocTitleColumn(dialect)} AS doc_title,
            ${missionSearchDocBodyColumn(dialect)} AS doc_body,
            ${missionSearchEntityTypeColumn(dialect)} AS entity_type,
            ${missionSearchDocScoreExpr(dialect)} AS doc_score
       FROM ${missionSearchFromClause(dialect)}
       JOIN missions t ON t.id = ${missionSearchMissionIdColumn(dialect)}
         AND t.workspace_id = ? AND t.deleted_at IS NULL
      JOIN projects p ON p.id = t.project_id
      JOIN workspaces w ON w.id = t.workspace_id
      WHERE ${missionSearchMatchPredicate(dialect)}
        AND ${missionSearchEntityTypeColumn(dialect)} IN ('mission', 'objective', 'event')${filters.sql}`,
    [...missionSearchWorkspaceParams({ dialect, workspaceId, match }), ...filters.params]
  )) as SearchDocumentRow[];

  type Acc = {
    row: MissionLabelRow;
    scores: number[];
    texts: string[];
    kinds: Set<MissionSearchMatchKind>;
    bestSnippetSource: { score: number; text: string };
  };
  const byMission = new Map<string, Acc>();
  for (const row of rows) {
    const docText = `${row.doc_title ?? ''} ${row.doc_body ?? ''}`.trim();
    const existing = byMission.get(row.id);
    const missionRow: MissionLabelRow = {
      id: row.id,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      display_id: row.display_id,
      title: row.title,
      status_type: row.status_type,
      status_id: row.status_id,
      priority: row.priority,
      created_at: row.created_at,
      updated_at: row.updated_at,
      due_datetime: row.due_datetime,
      objective_count: row.objective_count,
      project_name: row.project_name,
      workspace_name: row.workspace_name,
      workspace_slug: row.workspace_slug
    };
    if (!existing) {
      const kinds = new Set<MissionSearchMatchKind>();
      if (row.entity_type === 'objective') kinds.add('objective');
      if (row.entity_type === 'event') kinds.add('event');
      byMission.set(row.id, {
        row: missionRow,
        scores: [Number(row.doc_score) || 0],
        texts: [docText, row.title, row.display_id],
        kinds,
        bestSnippetSource: { score: Number(row.doc_score) || 0, text: docText || row.title }
      });
      continue;
    }
    existing.scores.push(Number(row.doc_score) || 0);
    existing.texts.push(docText);
    if (row.entity_type === 'objective') existing.kinds.add('objective');
    if (row.entity_type === 'event') existing.kinds.add('event');
    const score = Number(row.doc_score) || 0;
    if (score > existing.bestSnippetSource.score && docText) {
      existing.bestSnippetSource = { score, text: docText };
    }
  }

  const coverageFloor = parsed.coverageFloor ?? 1;
  const eligible: Array<{
    acc: Acc;
    textScore: number;
    matchedTerms: string[];
    matchedIn: MissionSearchMatchKind[];
    exactDisplayId: boolean;
    exactTitle: boolean;
  }> = [];

  for (const acc of byMission.values()) {
    const haystack = acc.texts.join('\n');
    const matchedTerms = matchedTermsInText({ terms: parsed.terms, text: haystack });
    if (matchedTerms.length < coverageFloor) continue;

    const matchedIn: MissionSearchMatchKind[] = [...acc.kinds];
    if (matchedTermsInText({ terms: parsed.terms, text: acc.row.title }).length > 0) {
      matchedIn.push('title');
    }
    if (matchedTermsInText({ terms: parsed.terms, text: acc.row.display_id }).length > 0) {
      matchedIn.push('displayId');
    }
    const exactDisplayId =
      acc.row.display_id.toLowerCase() === parsed.raw.toLowerCase() ||
      parsed.terms.some(term => term === acc.row.display_id.toLowerCase());
    const exactTitle = acc.row.title.trim().toLowerCase() === parsed.raw.toLowerCase();

    eligible.push({
      acc,
      textScore: aggregateDocumentScore(acc.scores),
      matchedTerms,
      matchedIn: [...new Set(matchedIn)],
      exactDisplayId,
      exactTitle
    });
  }

  const byText = [...eligible].sort(
    (left, right) =>
      right.textScore - left.textScore ||
      right.acc.row.updated_at.localeCompare(left.acc.row.updated_at)
  );
  const textRankById = new Map(byText.map((entry, index) => [entry.acc.row.id, index + 1]));

  const byRecency = [...eligible].sort((left, right) =>
    right.acc.row.updated_at.localeCompare(left.acc.row.updated_at)
  );
  const recencyRankById = new Map(byRecency.map((entry, index) => [entry.acc.row.id, index + 1]));

  const ranked = eligible
    .map(entry => {
      const fused = fusedRankScore({
        textRank: textRankById.get(entry.acc.row.id) ?? eligible.length,
        recencyRank: recencyRankById.get(entry.acc.row.id) ?? eligible.length
      });
      const relevance = publicRelevance({
        exactDisplayId: entry.exactDisplayId,
        exactTitle: entry.exactTitle,
        titleMatch: entry.matchedIn.includes('title'),
        fused
      });
      return toHitFromRow({
        row: entry.acc.row,
        relevance,
        snippet: snippetAroundTerms({
          text: entry.acc.bestSnippetSource.text || entry.acc.row.title,
          terms: entry.matchedTerms
        }),
        matchedTerms: entry.matchedTerms,
        matchedIn: entry.matchedIn
      });
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt)
    );

  const hits = ranked.slice(0, cappedLimit);
  return envelope({
    parsed,
    hits,
    totalMatchedBeforeLimit: ranked.length,
    projectIds: projects,
    statusTypes: types,
    resourceKeys: resources,
    dateField: date,
    from: from ?? null,
    to: to ?? null,
    workspaceId
  });
}

export function toMissionSearchResultV2(hit: RankedMissionHit): MissionSearchResultV2 {
  return {
    id: hit.id,
    displayId: hit.displayId,
    title: hit.title,
    statusType: hit.statusType,
    statusId: hit.statusId,
    priority: hit.priority,
    projectId: hit.projectId,
    projectName: hit.projectName,
    workspaceId: hit.workspaceId,
    workspaceName: hit.workspaceName,
    workspaceSlug: hit.workspaceSlug,
    createdAt: hit.createdAt,
    updatedAt: hit.updatedAt,
    dueDatetime: hit.dueDatetime,
    objectiveCount: hit.objectiveCount,
    relevance: hit.relevance,
    snippet: hit.snippet,
    matchedTerms: hit.matchedTerms,
    matchedIn: hit.matchedIn
  };
}

export function toSearchMissionsResponseV2(
  result: WorkspaceMissionSearch
): SearchMissionsResponseV2 {
  return {
    version: 2,
    results: result.hits.map(hit => toMissionSearchResultV2(hit)),
    appliedFilters: result.appliedFilters,
    totalMatchedBeforeLimit: result.totalMatchedBeforeLimit,
    workspaceCounts: result.workspaceCounts
  };
}

export function mergeWorkspaceMissionSearches({
  results,
  limit
}: {
  results: WorkspaceMissionSearch[];
  limit: number;
}): SearchMissionsResponseV2 {
  const hits = results
    .flatMap(result => result.hits)
    .sort(
      (left, right) =>
        right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt)
    );
  const sliced = hits.slice(0, limit);
  const returnedByWorkspace = new Map<string, number>();
  for (const hit of sliced) {
    returnedByWorkspace.set(hit.workspaceId, (returnedByWorkspace.get(hit.workspaceId) ?? 0) + 1);
  }

  const workspaceCounts = results.flatMap(result =>
    result.workspaceCounts.map(count => ({
      workspaceId: count.workspaceId,
      matched: count.matched,
      returned: returnedByWorkspace.get(count.workspaceId) ?? 0
    }))
  );

  const appliedFilters = results[0]?.appliedFilters ?? {
    query: null,
    mode: 'fallback' as const,
    projectIds: [],
    resourceKeys: [],
    statusTypes: [],
    dateField: null,
    from: null,
    to: null,
    coverageFloor: null
  };

  return {
    version: 2,
    results: sliced.map(hit => toMissionSearchResultV2(hit)),
    appliedFilters,
    totalMatchedBeforeLimit: results.reduce(
      (sum, result) => sum + result.totalMatchedBeforeLimit,
      0
    ),
    workspaceCounts
  };
}

/**
 * Allocate a global result cap deterministically across authorized workspaces.
 * A workspace may not consume another's unused allotment: this deliberately
 * preserves representation of smaller workspaces in a skewed result set.
 */
export function allocateWorkspaceSearchLimits({
  workspaceIds,
  limit
}: {
  workspaceIds: string[];
  limit: number;
}): Map<string, number> {
  const ordered = [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right));
  const capped = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 25;
  const base = ordered.length === 0 ? 0 : Math.floor(capped / ordered.length);
  const remainder = ordered.length === 0 ? 0 : capped % ordered.length;
  return new Map(
    ordered.map((workspaceId, index) => [workspaceId, base + (index < remainder ? 1 : 0)])
  );
}

export type RankedSearchHitV3 = RankedMissionHit & {
  anchorOnly: boolean;
  matches: SearchMatch[];
  matchCounts: { objective: number; delivery: number; event: number };
};

export type WorkspaceSearchV3 = {
  parsed: ParsedMissionSearchQuery;
  hits: RankedSearchHitV3[];
  totalMatchedBeforeLimit: number;
  appliedFilters: SearchAppliedFiltersV3;
  workspaceCounts: Array<{ workspaceId: string; matched: number; returned: number }>;
  entityCounts: SearchEntityCounts;
  truncatedCandidates: boolean;
};

type MissionSearchFieldRow = MissionLabelRow & {
  constraints_text?: string | null;
  output_format_text?: string | null;
  notes_text?: string | null;
};

type SearchDocumentRowV3 = SearchDocumentRow & {
  entity_id: string | null;
  constraints_text?: string | null;
  output_format_text?: string | null;
  notes_text?: string | null;
};

type ObjectiveSearchMeta = {
  id: string;
  displayKey: string;
  title: string | null;
  instructionText: string;
  state: string;
  createdAt: string;
  updatedAt: string;
};

type DeliverySearchMeta = {
  id: string;
  objectiveId: string | null;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

type SearchDocHit = {
  entityType: string;
  entityId: string;
  score: number;
  title: string | null;
  body: string | null;
};

export function searchChildRelevance({
  docScore,
  missionScore
}: {
  docScore: number;
  missionScore: number;
}): number {
  return docScore + SEARCH_CHILD_CONTEXT_WEIGHT * missionScore;
}

export function normalizeSearchV3Options({
  entityTypes,
  objectiveStates,
  matchesPerResult,
  candidateLimit
}: {
  entityTypes?: string[] | null;
  objectiveStates?: string[] | null;
  matchesPerResult?: number | string | null;
  candidateLimit?: number | null;
}): {
  entityTypes: SearchResultEntityType[];
  objectiveStates: SearchObjectiveState[];
  matchesPerResult: number;
  candidateLimit: number;
} {
  const entities = parseSearchEntityTypes(entityTypes);
  if (!entities.ok) throw new ServiceError(entities.error, 'validation_error');
  const states = parseSearchObjectiveStates(objectiveStates);
  if (!states.ok) throw new ServiceError(states.error, 'validation_error');
  const matches = parseMatchesPerResult(matchesPerResult);
  if (!matches.ok) throw new ServiceError(matches.error, 'validation_error');
  const cap =
    candidateLimit === null || candidateLimit === undefined
      ? SEARCH_CANDIDATE_FETCH_LIMIT
      : Math.trunc(Number(candidateLimit));
  if (!Number.isFinite(cap) || cap < 1) {
    throw new ServiceError('candidateLimit must be a positive integer', 'validation_error');
  }
  return {
    entityTypes: entities.value,
    objectiveStates: states.value,
    matchesPerResult: matches.value,
    candidateLimit: cap
  };
}

function emptyEntityCounts(): SearchEntityCounts {
  return { mission: 0, objective: 0, delivery: 0, event: 0 };
}

function addEntityCount({
  counts,
  entityType,
  amount = 1
}: {
  counts: SearchEntityCounts;
  entityType: string;
  amount?: number;
}): void {
  if (
    entityType === 'mission' ||
    entityType === 'objective' ||
    entityType === 'delivery' ||
    entityType === 'event'
  ) {
    counts[entityType] += amount;
  }
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function firstLine(text: string | null | undefined): string {
  const line = (text ?? '').trim().split(/\r?\n/, 1)[0] ?? '';
  return line.trim();
}

function documentTypesForSearch(entityTypes: SearchResultEntityType[]): string[] {
  return [...new Set<string>(['event', ...entityTypes])];
}

function passesObjectiveState({
  state,
  objectiveStates
}: {
  state: string | null | undefined;
  objectiveStates: SearchObjectiveState[];
}): boolean {
  if (objectiveStates.length === 0) return true;
  if (!state) return false;
  return objectiveStates.includes(state as SearchObjectiveState);
}

function missionRecordMatchKinds({
  row,
  terms
}: {
  row: MissionSearchFieldRow;
  terms: string[];
}): MissionSearchMatchKind[] {
  const kinds: MissionSearchMatchKind[] = [];
  if (matchedTermsInText({ terms, text: row.title }).length > 0) kinds.push('title');
  if (matchedTermsInText({ terms, text: row.display_id }).length > 0) kinds.push('displayId');
  const constraints = `${row.constraints_text ?? ''} ${row.output_format_text ?? ''}`;
  if (matchedTermsInText({ terms, text: constraints }).length > 0) kinds.push('constraints');
  if (matchedTermsInText({ terms, text: row.notes_text ?? '' }).length > 0) kinds.push('notes');
  return kinds;
}

function toSearchHitV3({
  row,
  relevance,
  snippet,
  matchedTerms,
  matchedIn,
  anchorOnly,
  matches,
  matchCounts
}: {
  row: MissionLabelRow;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  matchedIn: MissionSearchMatchKind[];
  anchorOnly: boolean;
  matches: SearchMatch[];
  matchCounts: { objective: number; delivery: number; event: number };
}): RankedSearchHitV3 {
  return {
    ...toHitFromRow({ row, relevance, snippet, matchedTerms, matchedIn }),
    anchorOnly,
    matches,
    matchCounts
  };
}

function buildAppliedFiltersV3({
  parsed,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  entityTypes,
  objectiveStates,
  matchesPerResult
}: {
  parsed: ParsedMissionSearchQuery;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  entityTypes: SearchResultEntityType[];
  objectiveStates: SearchObjectiveState[];
  matchesPerResult: number;
}): SearchAppliedFiltersV3 {
  return {
    ...buildAppliedFilters({
      parsed,
      projectIds,
      statusTypes,
      resourceKeys,
      dateField,
      from,
      to
    }),
    entityTypes,
    objectiveStates,
    matchesPerResult
  };
}

function envelopeV3({
  parsed,
  hits,
  totalMatchedBeforeLimit,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  workspaceId,
  entityTypes,
  objectiveStates,
  matchesPerResult,
  entityCounts,
  truncatedCandidates
}: {
  parsed: ParsedMissionSearchQuery;
  hits: RankedSearchHitV3[];
  totalMatchedBeforeLimit: number;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  workspaceId: string;
  entityTypes: SearchResultEntityType[];
  objectiveStates: SearchObjectiveState[];
  matchesPerResult: number;
  entityCounts: SearchEntityCounts;
  truncatedCandidates: boolean;
}): WorkspaceSearchV3 {
  return {
    parsed,
    hits,
    totalMatchedBeforeLimit,
    appliedFilters: buildAppliedFiltersV3({
      parsed,
      projectIds,
      statusTypes,
      resourceKeys,
      dateField,
      from,
      to,
      entityTypes,
      objectiveStates,
      matchesPerResult
    }),
    workspaceCounts: [{ workspaceId, matched: totalMatchedBeforeLimit, returned: hits.length }],
    entityCounts,
    truncatedCandidates
  };
}

function missionRowFromDocument(row: SearchDocumentRowV3): MissionSearchFieldRow {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    display_id: row.display_id,
    title: row.title,
    status_type: row.status_type,
    status_id: row.status_id,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at,
    due_datetime: row.due_datetime,
    objective_count: row.objective_count,
    project_name: row.project_name,
    workspace_name: row.workspace_name,
    workspace_slug: row.workspace_slug,
    constraints_text: row.constraints_text ?? null,
    output_format_text: row.output_format_text ?? null,
    notes_text: row.notes_text ?? null
  };
}

async function loadMatchMetadata({
  db,
  objectiveIds,
  deliveryIds
}: {
  db: DatabaseClient;
  objectiveIds: string[];
  deliveryIds: string[];
}): Promise<{
  objectives: Map<string, ObjectiveSearchMeta>;
  deliveries: Map<string, DeliverySearchMeta>;
}> {
  const objectives = new Map<string, ObjectiveSearchMeta>();
  const deliveries = new Map<string, DeliverySearchMeta>();
  const uniqueObjectives = [...new Set(objectiveIds)];
  const uniqueDeliveries = [...new Set(deliveryIds)];

  if (uniqueObjectives.length > 0) {
    const rows = (await db.all(
      `SELECT id, display_key, title, instruction_text, state, created_at, updated_at
         FROM objectives
        WHERE id IN (${sqlPlaceholders(uniqueObjectives.length)}) AND deleted_at IS NULL`,
      uniqueObjectives
    )) as Array<{
      id: string;
      display_key: string;
      title: string | null;
      instruction_text: string;
      state: string;
      created_at: string;
      updated_at: string;
    }>;
    for (const row of rows) {
      objectives.set(row.id, {
        id: row.id,
        displayKey: row.display_key,
        title: row.title,
        instructionText: row.instruction_text,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
  }

  if (uniqueDeliveries.length > 0) {
    const rows = (await db.all(
      `SELECT id, objective_id, summary, created_at, updated_at
         FROM deliveries
        WHERE id IN (${sqlPlaceholders(uniqueDeliveries.length)}) AND deleted_at IS NULL`,
      uniqueDeliveries
    )) as Array<{
      id: string;
      objective_id: string | null;
      summary: string;
      created_at: string;
      updated_at: string;
    }>;
    for (const row of rows) {
      deliveries.set(row.id, {
        id: row.id,
        objectiveId: row.objective_id,
        summary: row.summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
    const missingOwners = [
      ...new Set(
        [...deliveries.values()]
          .map(delivery => delivery.objectiveId)
          .filter((id): id is string => id !== null && id !== '')
          .filter(id => !objectives.has(id))
      )
    ];
    if (missingOwners.length > 0) {
      const extra = await loadMatchMetadata({
        db,
        objectiveIds: missingOwners,
        deliveryIds: []
      });
      for (const [id, meta] of extra.objectives) objectives.set(id, meta);
    }
  }

  return { objectives, deliveries };
}

async function lookupObjectiveByDisplayKey({
  db,
  missionId,
  displayKey
}: {
  db: DatabaseClient;
  missionId: string;
  displayKey: string;
}): Promise<ObjectiveSearchMeta | undefined> {
  const row = (await db.get(
    `SELECT id, display_key, title, instruction_text, state, created_at, updated_at
       FROM objectives
      WHERE mission_id = ? AND lower(display_key) = lower(?) AND deleted_at IS NULL`,
    [missionId, displayKey]
  )) as
    | {
        id: string;
        display_key: string;
        title: string | null;
        instruction_text: string;
        state: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    displayKey: row.display_key,
    title: row.title,
    instructionText: row.instruction_text,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toObjectiveSearchMatch({
  meta,
  missionDisplayId,
  relevance,
  snippet,
  matchedTerms
}: {
  meta: ObjectiveSearchMeta;
  missionDisplayId: string;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
}): SearchMatch {
  return {
    entityType: 'objective',
    id: meta.id,
    displayId: formatObjectiveDisplayId({
      missionDisplayId,
      displayKey: meta.displayKey
    }),
    title: meta.title?.trim() || firstLine(meta.instructionText) || 'Objective',
    objectiveId: meta.id,
    objectiveState: meta.state,
    relevance,
    snippet,
    matchedTerms,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt
  };
}

function toDeliverySearchMatch({
  meta,
  owner,
  relevance,
  snippet,
  matchedTerms
}: {
  meta: DeliverySearchMeta;
  owner: ObjectiveSearchMeta | undefined;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
}): SearchMatch {
  return {
    entityType: 'delivery',
    id: meta.id,
    displayId: null,
    title: firstLine(meta.summary) || 'Delivery',
    objectiveId: meta.objectiveId,
    objectiveState: owner?.state ?? null,
    relevance,
    snippet,
    matchedTerms,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt
  };
}

function buildChildMatch({
  doc,
  missionDisplayId,
  missionScore,
  terms,
  objectives,
  deliveries
}: {
  doc: SearchDocHit;
  missionDisplayId: string;
  missionScore: number;
  terms: string[];
  objectives: Map<string, ObjectiveSearchMeta>;
  deliveries: Map<string, DeliverySearchMeta>;
}): SearchMatch | null {
  const text = `${doc.title ?? ''} ${doc.body ?? ''}`.trim();
  const childMatchedTerms = matchedTermsInText({ terms, text });
  const snippet = snippetAroundTerms({
    text: text || doc.title || '',
    terms: childMatchedTerms
  });
  const relevance = searchChildRelevance({ docScore: doc.score, missionScore });
  if (doc.entityType === 'objective') {
    const meta = objectives.get(doc.entityId);
    if (!meta) return null;
    return toObjectiveSearchMatch({
      meta,
      missionDisplayId,
      relevance,
      snippet,
      matchedTerms: childMatchedTerms
    });
  }
  if (doc.entityType === 'delivery') {
    const meta = deliveries.get(doc.entityId);
    if (!meta) return null;
    return toDeliverySearchMatch({
      meta,
      owner: meta.objectiveId ? objectives.get(meta.objectiveId) : undefined,
      relevance,
      snippet,
      matchedTerms: childMatchedTerms
    });
  }
  return null;
}

/**
 * Portable per-workspace v3 search. Groups identifiable objective and delivery
 * matches under their mission anchor. Events remain corroboration-only.
 */
export async function searchWorkspaceMissionsV3({
  db,
  workspaceId,
  query,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25,
  entityTypes,
  objectiveStates,
  matchesPerResult,
  candidateLimit
}: {
  db: DatabaseClient;
  workspaceId: string;
  query?: string | null;
  projectIds?: string[] | null;
  statusTypes?: string[] | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  entityTypes?: string[] | null;
  objectiveStates?: string[] | null;
  matchesPerResult?: number | string | null;
  candidateLimit?: number | null;
}): Promise<WorkspaceSearchV3> {
  const parsed = parseMissionSearchQuery(query ?? '');
  const projects = projectIds?.filter(id => id.trim() !== '') ?? [];
  const types = statusTypes?.filter(type => type.trim() !== '') ?? [];
  const resources = resourceKeys?.filter(key => key.trim() !== '') ?? [];
  const boundsPresent = Boolean(from || to);
  const date = dateField ?? (boundsPresent ? 'updatedAt' : null);
  if (date !== null && date !== 'createdAt' && date !== 'updatedAt' && date !== 'dueDatetime') {
    throw new ServiceError(
      'dateField must be createdAt, updatedAt, or dueDatetime',
      'validation_error'
    );
  }
  validateDateBound('from', from);
  validateDateBound('to', to);
  if (from && to && Date.parse(from) >= Date.parse(to)) {
    throw new ServiceError('from must be earlier than to', 'validation_error');
  }
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 25;
  const options = normalizeSearchV3Options({
    entityTypes,
    objectiveStates,
    matchesPerResult,
    candidateLimit
  });
  const emptyMatchCounts = { objective: 0, delivery: 0, event: 0 };

  const wrap = ({
    hits,
    totalMatchedBeforeLimit,
    entityCounts,
    truncatedCandidates
  }: {
    hits: RankedSearchHitV3[];
    totalMatchedBeforeLimit: number;
    entityCounts: SearchEntityCounts;
    truncatedCandidates: boolean;
  }) =>
    envelopeV3({
      parsed,
      hits,
      totalMatchedBeforeLimit,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      workspaceId,
      entityTypes: options.entityTypes,
      objectiveStates: options.objectiveStates,
      matchesPerResult: options.matchesPerResult,
      entityCounts,
      truncatedCandidates
    });

  if (parsed.mode === 'fallback') {
    const { rows, total } = await listFallbackMissions({
      db,
      workspaceId,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      limit: cappedLimit
    });
    const hits = rows.map(row =>
      toSearchHitV3({
        row,
        relevance: 0,
        snippet: null,
        matchedTerms: [],
        matchedIn: [],
        anchorOnly: false,
        matches: [],
        matchCounts: { ...emptyMatchCounts }
      })
    );
    return wrap({
      hits,
      totalMatchedBeforeLimit: total,
      entityCounts: emptyEntityCounts(),
      truncatedCandidates: false
    });
  }

  if (parsed.mode === 'display_id' && parsed.displayId) {
    return wrap(
      await searchDisplayIdV3({
        db,
        workspaceId,
        parsed,
        rowLookup: {
          projectIds: projects,
          statusTypes: types,
          resourceKeys: resources,
          dateField: date,
          from: from ?? null,
          to: to ?? null
        },
        options
      })
    );
  }

  const match = buildMissionSearchMatch({ dialect: db.dialect, terms: parsed.terms });
  if (!match) {
    return searchWorkspaceMissionsV3({
      db,
      workspaceId,
      query: '',
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      limit: cappedLimit,
      entityTypes: options.entityTypes,
      objectiveStates: options.objectiveStates,
      matchesPerResult: options.matchesPerResult,
      candidateLimit: options.candidateLimit
    });
  }

  return wrap(
    await searchFullTextV3({
      db,
      workspaceId,
      parsed,
      match,
      projectIds: projects,
      statusTypes: types,
      resourceKeys: resources,
      dateField: date,
      from: from ?? null,
      to: to ?? null,
      cappedLimit,
      options
    })
  );
}

async function searchDisplayIdV3({
  db,
  workspaceId,
  parsed,
  rowLookup,
  options
}: {
  db: DatabaseClient;
  workspaceId: string;
  parsed: ParsedMissionSearchQuery;
  rowLookup: {
    projectIds: string[];
    statusTypes: string[];
    resourceKeys: string[];
    dateField: MissionSearchDateField | null;
    from: string | null;
    to: string | null;
  };
  options: ReturnType<typeof normalizeSearchV3Options>;
}): Promise<{
  hits: RankedSearchHitV3[];
  totalMatchedBeforeLimit: number;
  entityCounts: SearchEntityCounts;
  truncatedCandidates: boolean;
}> {
  const empty = {
    hits: [] as RankedSearchHitV3[],
    totalMatchedBeforeLimit: 0,
    entityCounts: emptyEntityCounts(),
    truncatedCandidates: false
  };
  const row = await lookupDisplayId({
    db,
    workspaceId,
    displayId: parsed.displayId!,
    ...rowLookup
  });
  if (!row) return empty;

  let matches: SearchMatch[] = [];
  const matchCounts = { objective: 0, delivery: 0, event: 0 };
  const entityCounts = emptyEntityCounts();
  if (parsed.objectiveDisplayKey) {
    const objective = await lookupObjectiveByDisplayKey({
      db,
      missionId: row.id,
      displayKey: parsed.objectiveDisplayKey
    });
    if (
      !objective ||
      !passesObjectiveState({
        state: objective.state,
        objectiveStates: options.objectiveStates
      })
    ) {
      return empty;
    }
    const snippet = snippetAroundTerms({
      text: objective.title || objective.instructionText || row.title,
      terms: [parsed.raw]
    });
    matches = [
      toObjectiveSearchMatch({
        meta: objective,
        missionDisplayId: row.display_id,
        relevance: publicRelevance({
          exactDisplayId: true,
          exactTitle: false,
          titleMatch: false,
          fused: 1
        }),
        snippet,
        matchedTerms: [parsed.raw]
      })
    ];
    matchCounts.objective = 1;
    entityCounts.objective = 1;
  } else {
    entityCounts.mission = 1;
  }

  return {
    hits: [
      toSearchHitV3({
        row,
        relevance: publicRelevance({
          exactDisplayId: true,
          exactTitle: false,
          titleMatch: false,
          fused: 1
        }),
        snippet: parsed.objectiveDisplayKey ? (matches[0]?.snippet ?? row.title) : row.title,
        matchedTerms: [parsed.displayId!],
        matchedIn: ['displayId'],
        anchorOnly: false,
        matches,
        matchCounts
      })
    ],
    totalMatchedBeforeLimit: 1,
    entityCounts,
    truncatedCandidates: false
  };
}

async function searchFullTextV3({
  db,
  workspaceId,
  parsed,
  match,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  cappedLimit,
  options
}: {
  db: DatabaseClient;
  workspaceId: string;
  parsed: ParsedMissionSearchQuery;
  match: string;
  projectIds: string[];
  statusTypes: string[];
  resourceKeys: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  cappedLimit: number;
  options: ReturnType<typeof normalizeSearchV3Options>;
}): Promise<{
  hits: RankedSearchHitV3[];
  totalMatchedBeforeLimit: number;
  entityCounts: SearchEntityCounts;
  truncatedCandidates: boolean;
}> {
  const filters = projectAndStatusSql({
    projectIds,
    statusTypes,
    resourceKeys,
    dateField,
    from,
    to
  });
  const dialect = db.dialect;
  const docTypes = documentTypesForSearch(options.entityTypes);
  const rows = (await db.all(
    `SELECT ${missionSelectColumns({ includeSearchFields: true })},
            ${missionSearchDocTitleColumnV3()} AS doc_title,
            ${missionSearchDocBodyColumnV3()} AS doc_body,
            ${missionSearchEntityTypeColumnV3()} AS entity_type,
            ${missionSearchEntityIdColumnV3()} AS entity_id,
            ${missionSearchDocScoreExprForWeights({ dialect, includeDelivery: true })} AS doc_score
       FROM ${missionSearchFromClauseV3(dialect)}
       JOIN missions t ON t.id = ${missionSearchMissionIdColumnV3()}
         AND t.workspace_id = ? AND t.deleted_at IS NULL
      JOIN projects p ON p.id = t.project_id
      JOIN workspaces w ON w.id = t.workspace_id
      WHERE ${missionSearchMatchPredicate(dialect)}
        AND ${missionSearchEntityTypeColumnV3()} IN (${sqlPlaceholders(docTypes.length)})${filters.sql}
      ORDER BY doc_score DESC
      LIMIT ?`,
    [
      ...missionSearchWorkspaceParams({ dialect, workspaceId, match }),
      ...docTypes,
      ...filters.params,
      options.candidateLimit
    ]
  )) as SearchDocumentRowV3[];

  const truncatedCandidates = rows.length >= options.candidateLimit;

  type Acc = {
    row: MissionSearchFieldRow;
    scores: number[];
    texts: string[];
    docs: SearchDocHit[];
    kinds: Set<MissionSearchMatchKind>;
    bestSnippetSource: { score: number; text: string };
  };
  const byMission = new Map<string, Acc>();
  for (const row of rows) {
    const docText = `${row.doc_title ?? ''} ${row.doc_body ?? ''}`.trim();
    const existing = byMission.get(row.id);
    const missionRow = missionRowFromDocument(row);
    const doc: SearchDocHit = {
      entityType: row.entity_type ?? '',
      entityId: row.entity_id ?? '',
      score: Number(row.doc_score) || 0,
      title: row.doc_title,
      body: row.doc_body
    };
    if (!existing) {
      const kinds = new Set<MissionSearchMatchKind>();
      if (row.entity_type === 'objective') kinds.add('objective');
      if (row.entity_type === 'event') kinds.add('event');
      if (row.entity_type === 'delivery') kinds.add('delivery');
      byMission.set(row.id, {
        row: missionRow,
        scores: [doc.score],
        texts: [docText, row.title, row.display_id],
        docs: [doc],
        kinds,
        bestSnippetSource: { score: doc.score, text: docText || row.title }
      });
      continue;
    }
    existing.scores.push(doc.score);
    existing.texts.push(docText);
    existing.docs.push(doc);
    if (row.entity_type === 'objective') existing.kinds.add('objective');
    if (row.entity_type === 'event') existing.kinds.add('event');
    if (row.entity_type === 'delivery') existing.kinds.add('delivery');
    if (doc.score > existing.bestSnippetSource.score && docText) {
      existing.bestSnippetSource = { score: doc.score, text: docText };
    }
  }

  const { objectives, deliveries } = await loadMatchMetadata({
    db,
    objectiveIds: [...byMission.values()].flatMap(acc =>
      acc.docs.filter(doc => doc.entityType === 'objective').map(doc => doc.entityId)
    ),
    deliveryIds: [...byMission.values()].flatMap(acc =>
      acc.docs.filter(doc => doc.entityType === 'delivery').map(doc => doc.entityId)
    )
  });

  const coverageFloor = parsed.coverageFloor ?? 1;
  const missionAllowed = options.entityTypes.includes('mission');
  const eligible: Array<{
    acc: Acc;
    textScore: number;
    matchedTerms: string[];
    matchedIn: MissionSearchMatchKind[];
    exactDisplayId: boolean;
    exactTitle: boolean;
    recordKinds: MissionSearchMatchKind[];
    matches: SearchMatch[];
    matchCounts: { objective: number; delivery: number; event: number };
    entityCounts: SearchEntityCounts;
  }> = [];

  for (const acc of byMission.values()) {
    const haystack = acc.texts.join('\n');
    const groupMatchedTerms = matchedTermsInText({ terms: parsed.terms, text: haystack });
    if (groupMatchedTerms.length < coverageFloor) continue;

    const recordKinds = missionRecordMatchKinds({ row: acc.row, terms: parsed.terms });
    const filteredDocs = acc.docs.filter(doc => {
      if (doc.entityType === 'objective') {
        return passesObjectiveState({
          state: objectives.get(doc.entityId)?.state,
          objectiveStates: options.objectiveStates
        });
      }
      if (doc.entityType === 'delivery') {
        const meta = deliveries.get(doc.entityId);
        const owner = meta?.objectiveId ? objectives.get(meta.objectiveId) : undefined;
        return passesObjectiveState({
          state: owner?.state,
          objectiveStates: options.objectiveStates
        });
      }
      return true;
    });

    const childDocs = filteredDocs.filter(
      doc => doc.entityType === 'objective' || doc.entityType === 'delivery'
    );
    const missionScore = aggregateDocumentScore(acc.scores);
    const childMatches = childDocs
      .map(doc =>
        buildChildMatch({
          doc,
          missionDisplayId: acc.row.display_id,
          missionScore,
          terms: parsed.terms,
          objectives,
          deliveries
        })
      )
      .filter((child): child is SearchMatch => child !== null)
      .sort(
        (left, right) =>
          right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt)
      );

    if (options.objectiveStates.length > 0 && childMatches.length === 0) continue;

    const missionHit = missionAllowed && recordKinds.length > 0;
    const eventHit = filteredDocs.some(doc => doc.entityType === 'event');
    if (childMatches.length === 0 && !missionHit && !(missionAllowed && eventHit)) continue;

    const matchCounts = {
      objective: filteredDocs.filter(doc => doc.entityType === 'objective').length,
      delivery: filteredDocs.filter(doc => doc.entityType === 'delivery').length,
      event: filteredDocs.filter(doc => doc.entityType === 'event').length
    };
    const entityCounts = emptyEntityCounts();
    for (const doc of filteredDocs) {
      addEntityCount({ counts: entityCounts, entityType: doc.entityType });
    }

    const matchedIn: MissionSearchMatchKind[] = [...acc.kinds, ...recordKinds];
    const exactDisplayId =
      acc.row.display_id.toLowerCase() === parsed.raw.toLowerCase() ||
      parsed.terms.some(term => term === acc.row.display_id.toLowerCase());
    const exactTitle = acc.row.title.trim().toLowerCase() === parsed.raw.toLowerCase();

    eligible.push({
      acc,
      textScore: missionScore,
      matchedTerms: groupMatchedTerms,
      matchedIn: [...new Set(matchedIn)],
      exactDisplayId,
      exactTitle,
      recordKinds,
      matches: childMatches.slice(0, options.matchesPerResult),
      matchCounts,
      entityCounts
    });
  }

  const byText = [...eligible].sort(
    (left, right) =>
      right.textScore - left.textScore ||
      right.acc.row.updated_at.localeCompare(left.acc.row.updated_at)
  );
  const textRankById = new Map(byText.map((entry, index) => [entry.acc.row.id, index + 1]));
  const byRecency = [...eligible].sort((left, right) =>
    right.acc.row.updated_at.localeCompare(left.acc.row.updated_at)
  );
  const recencyRankById = new Map(byRecency.map((entry, index) => [entry.acc.row.id, index + 1]));

  const ranked = eligible
    .map(entry => {
      const fused = fusedRankScore({
        textRank: textRankById.get(entry.acc.row.id) ?? eligible.length,
        recencyRank: recencyRankById.get(entry.acc.row.id) ?? eligible.length
      });
      return toSearchHitV3({
        row: entry.acc.row,
        relevance: publicRelevance({
          exactDisplayId: entry.exactDisplayId,
          exactTitle: entry.exactTitle,
          titleMatch: entry.matchedIn.includes('title'),
          fused
        }),
        snippet: snippetAroundTerms({
          text: entry.acc.bestSnippetSource.text || entry.acc.row.title,
          terms: entry.matchedTerms
        }),
        matchedTerms: entry.matchedTerms,
        matchedIn: entry.matchedIn,
        anchorOnly: !missionAllowed || entry.recordKinds.length === 0,
        matches: entry.matches,
        matchCounts: entry.matchCounts
      });
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt)
    );

  const entityCounts = emptyEntityCounts();
  for (const entry of eligible) {
    addEntityCount({
      counts: entityCounts,
      entityType: 'mission',
      amount: entry.entityCounts.mission
    });
    addEntityCount({
      counts: entityCounts,
      entityType: 'objective',
      amount: entry.entityCounts.objective
    });
    addEntityCount({
      counts: entityCounts,
      entityType: 'delivery',
      amount: entry.entityCounts.delivery
    });
    addEntityCount({
      counts: entityCounts,
      entityType: 'event',
      amount: entry.entityCounts.event
    });
  }

  return {
    hits: ranked.slice(0, cappedLimit),
    totalMatchedBeforeLimit: ranked.length,
    entityCounts,
    truncatedCandidates
  };
}

export function toSearchResultV3(hit: RankedSearchHitV3): SearchResultV3 {
  return {
    ...toMissionSearchResultV2(hit),
    anchorOnly: hit.anchorOnly,
    matches: hit.matches,
    matchCounts: hit.matchCounts
  };
}

export function toSearchResponseV3(result: WorkspaceSearchV3): SearchResponseV3 {
  return {
    version: 3,
    results: result.hits.map(hit => toSearchResultV3(hit)),
    appliedFilters: result.appliedFilters,
    totalMatchedBeforeLimit: result.totalMatchedBeforeLimit,
    entityCounts: result.entityCounts,
    workspaceCounts: result.workspaceCounts,
    truncatedCandidates: result.truncatedCandidates
  };
}

export function mergeWorkspaceSearchV3({
  results,
  limit
}: {
  results: WorkspaceSearchV3[];
  limit: number;
}): SearchResponseV3 {
  const hits = results
    .flatMap(result => result.hits)
    .sort(
      (left, right) =>
        right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt)
    );
  const sliced = hits.slice(0, limit);
  const returnedByWorkspace = new Map<string, number>();
  for (const hit of sliced) {
    returnedByWorkspace.set(hit.workspaceId, (returnedByWorkspace.get(hit.workspaceId) ?? 0) + 1);
  }

  const workspaceCounts = results.flatMap(result =>
    result.workspaceCounts.map(count => ({
      workspaceId: count.workspaceId,
      matched: count.matched,
      returned: returnedByWorkspace.get(count.workspaceId) ?? 0
    }))
  );

  const appliedFilters = results[0]?.appliedFilters ?? {
    query: null,
    mode: 'fallback' as const,
    projectIds: [],
    resourceKeys: [],
    statusTypes: [],
    dateField: null,
    from: null,
    to: null,
    coverageFloor: null,
    entityTypes: [...DEFAULT_SEARCH_ENTITY_TYPES],
    objectiveStates: [],
    matchesPerResult: 3
  };

  const entityCounts = emptyEntityCounts();
  for (const result of results) {
    addEntityCount({
      counts: entityCounts,
      entityType: 'mission',
      amount: result.entityCounts.mission
    });
    addEntityCount({
      counts: entityCounts,
      entityType: 'objective',
      amount: result.entityCounts.objective
    });
    addEntityCount({
      counts: entityCounts,
      entityType: 'delivery',
      amount: result.entityCounts.delivery
    });
    addEntityCount({
      counts: entityCounts,
      entityType: 'event',
      amount: result.entityCounts.event
    });
  }

  return {
    version: 3,
    results: sliced.map(hit => toSearchResultV3(hit)),
    appliedFilters,
    totalMatchedBeforeLimit: results.reduce(
      (sum, result) => sum + result.totalMatchedBeforeLimit,
      0
    ),
    entityCounts,
    workspaceCounts,
    truncatedCandidates: results.some(result => result.truncatedCandidates)
  };
}
