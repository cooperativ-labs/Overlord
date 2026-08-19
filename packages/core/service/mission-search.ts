import type {
  MissionSearchAppliedFilters,
  MissionSearchMatchKind,
  MissionSearchResultV2,
  SearchMissionsResponseV2
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { ServiceError } from './errors.js';
import { type ParsedMissionSearchQuery, parseMissionSearchQuery } from './mission-search-query.js';
import {
  buildMissionSearchMatch,
  missionSearchDocBodyColumn,
  missionSearchDocScoreExpr,
  missionSearchDocTitleColumn,
  missionSearchEntityTypeColumn,
  missionSearchFromClause,
  missionSearchMatchPredicate,
  missionSearchMissionIdColumn,
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
  objective_count: number;
  project_name: string;
  workspace_name: string;
  workspace_slug: string;
};

function missionSelectColumns(): string {
  return `t.id, t.workspace_id, t.project_id, t.display_id, t.title,
          t.status_type, t.status_id, t.priority, t.created_at, t.updated_at,
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
  dateField: 'createdAt' | 'updatedAt' | null;
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
  const dateColumn = dateField === 'createdAt' ? 't.created_at' : 't.updated_at';
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
  dateField: 'createdAt' | 'updatedAt' | null;
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
  dateField: 'createdAt' | 'updatedAt' | null;
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
  dateField: 'createdAt' | 'updatedAt' | null;
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
  dateField: 'createdAt' | 'updatedAt' | null;
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
  dateField?: 'createdAt' | 'updatedAt' | null;
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
  if (date !== null && date !== 'createdAt' && date !== 'updatedAt') {
    throw new ServiceError('dateField must be createdAt or updatedAt', 'validation_error');
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
      WHERE ${missionSearchMatchPredicate(dialect)}${filters.sql}`,
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
