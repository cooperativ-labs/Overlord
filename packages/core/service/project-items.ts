import type { DatabaseClient, MissionItemKind } from '@overlord/database';

import { ServiceError } from './errors.js';

const GENERIC = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'readme.md',
  'package.json',
  'mod.rs',
  'lib.rs',
  'main.rs',
  '__init__.py',
  'index.md'
]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Repo-relative, case-sensitive paths; never resolve against a host filesystem. */
export function normalizeItemPath(path: string): string | null {
  const value = path
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return !value ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some(p => p === '..' || p === '.')
    ? null
    : value;
}

/** New additive algorithm, pinned by project-item-match-vectors.json (ADR 0081). */
export function matchProjectItem(text: string, paths: readonly string[]) {
  const tokens = new Set(
    text
      .match(/[A-Za-z0-9_@.~-]+(?:[\\/][A-Za-z0-9_@.~-]+)*/g)
      ?.map(t => t.replace(/\\/g, '/').replace(/\.+$/, '')) ?? []
  );
  const matches: { path: string; score: number }[] = [];
  for (const path of [
    ...new Set(paths.map(normalizeItemPath).filter((p): p is string => p !== null))
  ].sort(compare)) {
    const parts = path.split('/');
    let score = tokens.has(path) ? 3 : 0;
    for (let n = 2; n < parts.length && score < 2; n++) {
      const prefix = parts.slice(0, n).join('/');
      if ([...tokens].some(t => t === prefix || t.startsWith(prefix + '/'))) score = 2;
    }
    const base = parts.at(-1)!;
    if (
      !score &&
      !GENERIC.has(base.toLowerCase()) &&
      [...tokens].some(t => t.split('/').at(-1) === base)
    )
      score = 1;
    if (score) matches.push({ path, score });
  }
  matches.sort((a, b) => b.score - a.score || compare(a.path, b.path));
  const score = matches[0]?.score ?? 0;
  return {
    paths: matches.slice(0, 5).map(m => m.path),
    strength: (['none', 'weak', 'medium', 'strong'] as const)[score]!
  };
}

// Accepted live deliveries only: report drafts have no join into this relation.
const FROM = `FROM mission_items mi
  JOIN deliveries d ON d.id = mi.delivery_id AND d.deleted_at IS NULL
  JOIN missions m ON m.id = mi.mission_id AND m.deleted_at IS NULL
  JOIN objectives o ON o.id = mi.objective_id AND o.deleted_at IS NULL
  WHERE mi.workspace_id = ? AND mi.project_id = ? AND m.workspace_id = mi.workspace_id
    AND m.project_id = mi.project_id AND mi.status = 'open'`;

export async function countOtherMissionOpenItems(
  db: DatabaseClient,
  scope: { workspaceId: string; projectId: string; missionId: string }
) {
  const row = await db.get<{ total: number | string }>(
    `SELECT COUNT(*) AS total ${FROM} AND mi.mission_id <> ?`,
    [scope.workspaceId, scope.projectId, scope.missionId]
  );
  return Number(row?.total ?? 0);
}

export interface ProjectItemOptions {
  workspaceId: string;
  projectId: string;
  missionId: string;
  kinds?: readonly string[];
  query?: string;
  paths?: readonly string[];
  includeOwnMission?: boolean;
  limit?: number;
  offset?: number;
}

export async function listProjectItemCandidates(
  db: DatabaseClient,
  scope: ProjectItemOptions,
  ledger: { paths: readonly string[]; captureGap: boolean }
) {
  const {
    limit = 20,
    offset = 0,
    query = '',
    paths = [],
    kinds = ['risk', 'human_action', 'suggestion']
  } = scope;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    query.length > 200 ||
    !kinds.length ||
    kinds.some(k => !['risk', 'human_action', 'suggestion'].includes(k)) ||
    paths.length > 200 ||
    paths.some(p => p.length > 1000 || !normalizeItemPath(p))
  ) {
    throw new ServiceError(
      'Invalid project-items filters: limit 1..100, non-negative offset, query <=200 characters, valid kinds and <=200 repo-relative paths',
      'invalid_input',
      400
    );
  }
  const where = scope.includeOwnMission ? '' : ' AND mi.mission_id <> ?';
  const params = [
    scope.workspaceId,
    scope.projectId,
    ...(scope.includeOwnMission ? [] : [scope.missionId])
  ];
  const count = await db.get<{ total: number | string }>(
    `SELECT COUNT(*) AS total ${FROM}${where}`,
    params
  );
  const rows = await db.all<{
    id: string;
    kind: MissionItemKind;
    text: string;
    detail_json: string | Record<string, unknown>;
    reported_at: string | Date;
    display_id: string;
    title: string;
    display_key: string;
  }>(
    `SELECT mi.id, mi.kind, mi.text, mi.detail_json, mi.reported_at, m.display_id, m.title, o.display_key ${FROM}${where}
      ORDER BY d.delivered_at DESC, d.id DESC, mi.kind ASC, mi.position ASC, mi.id ASC LIMIT 2000`,
    params
  );
  const ranked = rows.flatMap((row, order) => {
    const detail =
      typeof row.detail_json === 'string' ? JSON.parse(row.detail_json) : row.detail_json;
    const fields = [row.text, detail.change, detail.location, detail.doneWhen]
      .filter(v => typeof v === 'string')
      .join('\n');
    if (!kinds.includes(row.kind) || !fields.toLowerCase().includes(query.toLowerCase())) return [];
    const match = matchProjectItem([fields, JSON.stringify(detail), row.title].join('\n'), [
      ...ledger.paths,
      ...paths
    ]);
    return [{ order, match, row, detail }];
  });
  const scores = { none: 0, weak: 1, medium: 2, strong: 3 };
  ranked.sort((a, b) => scores[b.match.strength] - scores[a.match.strength] || a.order - b.order);
  const items = ranked.slice(offset, offset + limit).map(({ row, detail, match }) => ({
    id: row.id,
    kind: row.kind,
    mission: { displayId: row.display_id, title: row.title },
    objective: `${row.display_id}.${row.display_key}`,
    text: row.text.slice(0, 240),
    ...(row.text.length > 240 ? { textTruncated: true } : {}),
    ...(typeof detail.location === 'string' ? { location: detail.location.slice(0, 240) } : {}),
    blocking: typeof detail.blocking === 'boolean' ? detail.blocking : null,
    reportedAt: row.reported_at instanceof Date ? row.reported_at.toISOString() : row.reported_at,
    match
  }));
  const truncated = offset + items.length < ranked.length;
  return {
    responseShapeVersion: 1,
    projectId: scope.projectId,
    excludedMissionId: scope.includeOwnMission ? null : scope.missionId,
    total: ranked.length,
    items,
    limit,
    offset,
    nextOffset: truncated ? offset + items.length : null,
    truncated,
    scanTruncated: Number(count?.total ?? 0) > 2000,
    ledger: { paths: ledger.paths.length, captureGap: ledger.captureGap }
  };
}
