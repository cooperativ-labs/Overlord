import type { ObjectiveTranscriptItemDto, ObjectiveTranscriptPageDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { ServiceError } from './errors.js';

type Key = { at: string; id: string };
export type TranscriptRead = {
  limit: number;
  before: Key | null;
  after: Key | null;
  ids: string[] | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function invalid(): never {
  throw new ServiceError('Invalid objective transcript query', 'invalid_request', 400);
}
function cursor(key: Key): string {
  return Buffer.from(JSON.stringify([1, key.at, key.id])).toString('base64url');
}
function decode(value: unknown): Key {
  if (typeof value !== 'string' || value.length > 256 || !/^[\w-]+$/.test(value)) invalid();
  try {
    const key: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (
      !Array.isArray(key) ||
      key.length !== 3 ||
      key[0] !== 1 ||
      typeof key[1] !== 'string' ||
      !ISO.test(key[1]) ||
      !Number.isFinite(Date.parse(key[1])) ||
      new Date(key[1]).toISOString() !== key[1] ||
      typeof key[2] !== 'string' ||
      !UUID.test(key[2])
    )
      invalid();
    const result = { at: key[1], id: key[2] };
    if (cursor(result) !== value) invalid();
    return result;
  } catch {
    return invalid();
  }
}

export function parseTranscriptRead(query: Record<string, unknown>): TranscriptRead {
  if (Object.keys(query).some(key => !['limit', 'before', 'after', 'ids'].includes(key))) invalid();
  if ([query.before, query.after, query.ids].filter(value => value !== undefined).length > 1)
    invalid();
  const rawLimit = query.limit ?? '50';
  if (typeof rawLimit !== 'string' || !/^[1-9]\d{0,2}$/.test(rawLimit)) invalid();
  const limit = Number(rawLimit);
  if (limit > 100) invalid();
  let ids: string[] | null = null;
  if (query.ids !== undefined) {
    if (typeof query.ids !== 'string' || query.ids.length > 3699 || query.limit !== undefined)
      invalid();
    ids = query.ids.split(',');
    if (ids.length > 100 || ids.some(id => !UUID.test(id)) || new Set(ids).size !== ids.length)
      invalid();
  }
  return {
    limit,
    before: query.before === undefined ? null : decode(query.before),
    after: query.after === undefined ? null : decode(query.after),
    ids
  };
}

/** Caller supplies an already authorized scope; this service never expands it. */
export async function readObjectiveTranscript({
  db,
  workspaceIds,
  allowedProjectIds,
  read
}: {
  db: DatabaseClient;
  workspaceIds: readonly string[];
  allowedProjectIds: readonly string[] | null;
  read: TranscriptRead;
}): Promise<ObjectiveTranscriptPageDto> {
  const empty = {
    items: [],
    nextBefore: null,
    nextAfter: read.after ? cursor(read.after) : null,
    newestCursor: null,
    hasMore: false
  };
  if (!workspaceIds.length || allowedProjectIds?.length === 0) return empty;
  const marks = (values: readonly unknown[]) => values.map(() => '?').join(',');
  const filterParams: unknown[] = [];
  let filter = '';
  if (allowedProjectIds !== null) {
    filter += ` AND o.project_id IN (${marks(allowedProjectIds)})`;
    filterParams.push(...allowedProjectIds);
  }
  if (read.ids) {
    filter += ` AND o.id IN (${marks(read.ids)})`;
    filterParams.push(...read.ids);
  }
  const key = read.before ?? read.after;
  if (key) {
    const op = read.after ? '>' : '<';
    filter += ` AND (o.created_at ${op} ? OR (o.created_at = ? AND o.id ${op} ?))`;
    filterParams.push(key.at, key.at, key.id);
  }
  const direction = read.after ? 'ASC' : 'DESC';
  const limit = read.ids ? read.ids.length : read.limit;
  const lookahead = read.ids ? limit : limit + 1;
  const joins = `JOIN missions m ON m.id = o.mission_id AND m.project_id = o.project_id
      AND m.workspace_id = o.workspace_id AND m.deleted_at IS NULL
    JOIN projects p ON p.id = o.project_id AND p.workspace_id = o.workspace_id
      AND p.deleted_at IS NULL AND p.status = 'active'
    JOIN workspaces w ON w.id = o.workspace_id AND w.deleted_at IS NULL`;
  const params: unknown[] = [];
  // LIMIT inside each workspace walk prevents an IN(workspaces) plan from
  // sorting the entire organization archive before selecting its top rows.
  const scopes = workspaceIds.map((workspaceId, index) => {
    params.push(workspaceId, ...filterParams, lookahead);
    return `SELECT id FROM (SELECT o.id FROM objectives o ${joins}
      WHERE o.deleted_at IS NULL AND o.workspace_id = ?${filter}
      ORDER BY o.created_at ${direction}, o.id ${direction} LIMIT ?) scope_${index}`;
  });
  params.push(lookahead);
  // One bounded projection; no mission aggregates, sessions, queue hydration or N+1.
  const rows = await db.all<ObjectiveTranscriptItemDto & { projectSettings: string }>(
    `
    WITH candidates AS (${scopes.join(' UNION ALL ')})
    SELECT o.id, o.workspace_id AS "workspaceId", o.project_id AS "projectId",
      o.mission_id AS "missionId", m.display_id AS "missionDisplayId",
      m.title AS "missionTitle", m.revision AS "missionRevision", m.status_type AS "statusType",
      p.name AS "projectName", p.settings_json AS "projectSettings", p.revision AS "projectRevision",
      o.title, o.instruction_text AS "instructionText", o.state,
      o.assigned_agent AS "assignedAgent", o.resource_key AS "resourceKey",
      o.created_by_kind AS "createdByKind", o.created_by_agent AS "createdByAgent",
      o.created_by_workspace_user_id AS "createdByWorkspaceUserId",
      o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.revision
    FROM candidates c JOIN objectives o ON o.id = c.id ${joins}
    ORDER BY o.created_at ${direction}, o.id ${direction} LIMIT ?`,
    params
  );
  const hasMore = !read.ids && rows.length > limit;
  const items = rows.slice(0, limit).map(({ projectSettings, ...row }) => {
    let projectColor: string | null = null;
    try {
      const settings = JSON.parse(projectSettings) as Record<string, unknown>;
      if (typeof settings['overlord.color'] === 'string') projectColor = settings['overlord.color'];
    } catch {
      /* Invalid settings do not hide a readable objective. */
    }
    return { ...row, projectColor };
  });
  const asKey = (item: ObjectiveTranscriptItemDto) => ({ at: item.createdAt, id: item.id });
  const last = items.at(-1);
  const newest = read.after ? last : items[0];
  return {
    items,
    hasMore,
    nextBefore: !read.ids && !read.after && hasMore && last ? cursor(asKey(last)) : null,
    nextAfter: !read.ids && read.after ? (last ? cursor(asKey(last)) : cursor(read.after)) : null,
    newestCursor: newest ? cursor(asKey(newest)) : null
  };
}
