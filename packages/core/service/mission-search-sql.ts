import type { SqlDialect } from '@overlord/database';

import { parseMissionSearchQuery } from './mission-search-query.js';

/**
 * Turn free-form user input into a dialect-specific full-text match expression.
 * Meaningful terms become OR-combined prefix tokens so partial words match and
 * FTS boolean keywords stay neutralised. Returns null when there is nothing to
 * match (empty, stop-words-only, or a display-id short-circuit).
 */
export function buildMissionSearchMatch({
  dialect,
  query,
  terms
}: {
  dialect: SqlDialect;
  query?: string;
  terms?: string[];
}): string | null {
  const resolvedTerms = terms ?? (query ? parseMissionSearchQuery(query).terms : []);
  const ftsTerms = resolvedTerms.map(term => sanitizeFtsTerm(term)).filter(term => term.length > 0);
  if (ftsTerms.length === 0) return null;

  const separator = dialect === 'postgres' ? ' | ' : ' OR ';
  const prefixToken =
    dialect === 'postgres' ? (term: string) => `${term}:*` : (term: string) => `${term}*`;
  return ftsTerms.map(term => prefixToken(term)).join(separator);
}

function sanitizeFtsTerm(term: string): string {
  return (term.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join('');
}

/**
 * FROM clause for mission full-text search. PostgreSQL binds the tsquery once in a
 * derived table so ranking and the `@@` predicate share the same placeholder.
 */
export function missionSearchFromClause(dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    return `search_documents sd
             CROSS JOIN (SELECT to_tsquery('english', ?) AS tsq) q`;
  }
  return 'search_documents_fts';
}

/** Column on the indexed search source that joins to `missions.id`. */
export function missionSearchMissionIdColumn(dialect: SqlDialect): string {
  return dialect === 'postgres' ? 'sd.mission_id' : 'search_documents_fts.mission_id';
}

/** Column on the indexed search source used for entity-kind weighting. */
export function missionSearchEntityTypeColumn(dialect: SqlDialect): string {
  return dialect === 'postgres' ? 'sd.entity_type' : 'search_documents_fts.entity_type';
}

export function missionSearchDocTitleColumn(dialect: SqlDialect): string {
  return dialect === 'postgres' ? 'sd.title' : 'search_documents_fts.title';
}

export function missionSearchDocBodyColumn(dialect: SqlDialect): string {
  return dialect === 'postgres' ? 'sd.body_text' : 'search_documents_fts.body_text';
}

/**
 * Per-document relevance score for a full-text hit. SQLite uses FTS5 `bm25()`;
 * PostgreSQL uses `ts_rank()` over the generated `search_tsv` column.
 */
export function missionSearchDocScoreExpr(dialect: SqlDialect): string {
  const entityType = missionSearchEntityTypeColumn(dialect);
  const entityWeight = `(CASE ${entityType}
    WHEN 'mission' THEN 3.0 WHEN 'objective' THEN 2.0 ELSE 1.0 END)`;

  if (dialect === 'postgres') {
    return `${entityWeight} * ts_rank(sd.search_tsv, q.tsq)`;
  }

  return `${entityWeight} * (-bm25(search_documents_fts, 10.0, 1.0))`;
}

/** WHERE predicate that restricts indexed documents to the user's search terms. */
export function missionSearchMatchPredicate(dialect: SqlDialect): string {
  return dialect === 'postgres' ? 'sd.search_tsv @@ q.tsq' : 'search_documents_fts MATCH ?';
}

/** Workspace and match parameters in SQL placeholder order for the search FROM clause. */
export function missionSearchWorkspaceParams({
  dialect,
  workspaceId,
  match
}: {
  dialect: SqlDialect;
  workspaceId: string;
  match: string;
}): string[] {
  return dialect === 'postgres' ? [match, workspaceId] : [workspaceId, match];
}
