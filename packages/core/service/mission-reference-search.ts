import {
  containsExactReference,
  formatObjectiveDisplayId,
  invalidMissionReference,
  MISSION_REFERENCE_DEFAULT_LIMIT,
  MISSION_REFERENCE_MAX_LIMIT,
  type MissionReferenceMatch,
  type MissionReferenceSearchResponse
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';

import { ServiceError } from './errors.js';

/**
 * Exhaustive exact-reference lookup within one project (contract v155, C2).
 *
 * Unlike ranked search there is no candidate cap, fallback or relevance: every live
 * mission in the project whose live objective instruction text contains the exact
 * reference token is returned, in mission-id order, one page at a time. Callers must
 * authorize the project before calling; this function trusts `workspaceId`/`projectId`.
 */

type CursorBody = { v: 1; p: string; r: string; a: string };

function referenceDigest(reference: string): string {
  return createHash('sha256').update(reference).digest('hex').slice(0, 24);
}

function encodeCursor(body: CursorBody): string {
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, projectId: string, reference: string): string {
  let body: Partial<CursorBody> | null = null;
  try {
    body = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorBody>;
  } catch {
    body = null;
  }
  if (
    !body ||
    body.v !== 1 ||
    body.p !== projectId ||
    body.r !== referenceDigest(reference) ||
    typeof body.a !== 'string' ||
    body.a === ''
  ) {
    throw new ServiceError(
      'cursor does not belong to this reference and project; restart without a cursor',
      'validation_error'
    );
  }
  return body.a;
}

/** `%`, `_` and the escape character itself are literal inside the reference. */
function likePattern(reference: string): string {
  return `%${reference.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function normalizeMissionReferenceLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit))
    return MISSION_REFERENCE_DEFAULT_LIMIT;
  const n = Math.trunc(limit);
  if (n < 1 || n > MISSION_REFERENCE_MAX_LIMIT) {
    throw new ServiceError(
      `limit must be between 1 and ${MISSION_REFERENCE_MAX_LIMIT}`,
      'validation_error'
    );
  }
  return n;
}

export async function searchMissionReferencesInProject({
  db,
  workspaceId,
  projectId,
  reference,
  cursor,
  limit
}: {
  db: DatabaseClient;
  workspaceId: string;
  projectId: string;
  reference: string;
  cursor?: string | null;
  limit?: number | null;
}): Promise<MissionReferenceSearchResponse> {
  const invalid = invalidMissionReference(reference);
  if (invalid) throw new ServiceError(invalid, 'validation_error');
  const pageSize = normalizeMissionReferenceLimit(limit);
  const after = cursor ? decodeCursor(cursor, projectId, reference) : null;
  const pattern = likePattern(reference);

  // SQLite LIKE is ASCII case-insensitive and Postgres LIKE is case-sensitive, so the
  // SQL only narrows candidates; the exact, case-sensitive token check below decides.
  // The page boundary is over candidate missions, so a filtered-out candidate never
  // hides a later match.
  const candidates = await db.all<{
    id: string;
    display_id: string;
    title: string;
    status_type: string;
    status_id: string;
    project_id: string;
    workspace_id: string;
    created_at: unknown;
    updated_at: unknown;
  }>(
    `SELECT m.id, m.display_id, m.title, m.status_type, m.status_id, m.project_id,
            m.workspace_id, m.created_at, m.updated_at
       FROM missions m
      WHERE m.workspace_id = ? AND m.project_id = ? AND m.deleted_at IS NULL
        ${after ? 'AND m.id > ?' : ''}
        AND EXISTS (
          SELECT 1 FROM objectives o
           WHERE o.mission_id = m.id AND o.deleted_at IS NULL
             AND o.instruction_text LIKE ? ESCAPE '\\'
        )
      ORDER BY m.id
      LIMIT ?`,
    [workspaceId, projectId, ...(after ? [after] : []), pattern, pageSize + 1]
  );
  const page = candidates.slice(0, pageSize);
  const hasMore = candidates.length > pageSize;

  const objectivesByMission = new Map<string, MissionReferenceMatch['objectives']>();
  if (page.length) {
    const rows = await db.all<{
      id: string;
      mission_id: string;
      display_key: string;
      title: string | null;
      state: string;
      position: number;
      instruction_text: string | null;
    }>(
      `SELECT id, mission_id, display_key, title, state, position, instruction_text
         FROM objectives
        WHERE mission_id IN (${page.map(() => '?').join(', ')})
          AND deleted_at IS NULL AND instruction_text LIKE ? ESCAPE '\\'
        ORDER BY mission_id, position, id`,
      [...page.map(m => m.id), pattern]
    );
    const displayIds = new Map(page.map(m => [m.id, m.display_id]));
    for (const row of rows) {
      if (!containsExactReference(row.instruction_text ?? '', reference)) continue;
      const list = objectivesByMission.get(row.mission_id) ?? [];
      list.push({
        id: row.id,
        displayId: formatObjectiveDisplayId({
          missionDisplayId: displayIds.get(row.mission_id)!,
          displayKey: row.display_key
        }),
        title: row.title,
        state: row.state,
        position: Number(row.position)
      });
      objectivesByMission.set(row.mission_id, list);
    }
  }

  const results: MissionReferenceMatch[] = page.flatMap(m => {
    const objectives = objectivesByMission.get(m.id);
    return objectives?.length
      ? [
          {
            id: m.id,
            displayId: m.display_id,
            title: m.title,
            statusType: m.status_type,
            statusId: m.status_id,
            projectId: m.project_id,
            workspaceId: m.workspace_id,
            createdAt: timestamp(m.created_at),
            updatedAt: timestamp(m.updated_at),
            objectives
          }
        ]
      : [];
  });
  const nextCursor = hasMore
    ? encodeCursor({ v: 1, p: projectId, r: referenceDigest(reference), a: page.at(-1)!.id })
    : null;
  return {
    kind: 'mission_reference_search',
    version: 1,
    reference,
    projectId,
    workspaceId,
    results,
    nextCursor,
    complete: nextCursor === null
  };
}
