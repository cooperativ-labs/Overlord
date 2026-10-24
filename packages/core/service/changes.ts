import {
  CAPTURE_GAP_CODES,
  type CaptureBindingState,
  type CaptureHealthEntryDto,
  type CaptureSessionDto,
  type CaptureWarningCode,
  type FileChangeDto,
  type FileChangeSource,
  OBJECTIVE_FILE_CHANGES_LIMIT,
  type ObjectiveFileChangesDto
} from '@overlord/contract';

import type { ServiceContext } from './context.js';
import { resolveMissionId, resolveObjectiveRef } from './context.js';
import { ServiceError } from './errors.js';

type FileChangeRow = {
  id: string;
  mission_id: string;
  objective_id: string;
  file_path: string;
  source: string | null;
  hook_health: string | null;
  last_observed_at: string | Date;
  resource_key: string | null;
};

type CaptureSessionRow = {
  id: string;
  started_at: string | Date;
  capture_binding_state: string;
  capture_callback_observed_at: string | Date | null;
  capture_health_json: string | Record<string, unknown> | null;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toSource(value: string | null): FileChangeSource | null {
  return value === 'declared_edit' || value === 'agent_declared' ? value : null;
}

function toBindingState(value: string): CaptureBindingState {
  return value === 'bound' || value === 'unbound' ? value : 'unknown';
}

function readHealth(value: CaptureSessionRow['capture_health_json']): CaptureHealthEntryDto[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const health = (parsed as { health?: unknown } | null)?.health;
  if (typeof health !== 'object' || health === null) return [];
  return Object.entries(health as Record<string, { firstAt?: unknown; lastAt?: unknown }>)
    .filter(([, entry]) => typeof entry?.firstAt === 'string' && typeof entry.lastAt === 'string')
    .map(([code, entry]) => ({
      code,
      firstAt: entry.firstAt as string,
      lastAt: entry.lastAt as string
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

/**
 * Objective-level warnings across every session; a newer healthy session never
 * hides an earlier gap. Sync warnings are local-only and never produced here.
 * An objective with no session (sessionless record-work) has nothing to warn about.
 */
export function deriveCaptureWarnings(sessions: CaptureSessionDto[]): CaptureWarningCode[] {
  const warnings = new Set<CaptureWarningCode>();
  for (const session of sessions) {
    if (session.bindingState === 'unbound') warnings.add('unbound');
    else if (session.bindingState === 'unknown') warnings.add('unknown_binding');
    else if (!session.callbackObservedAt) warnings.add('bound_no_callback');
    if (
      session.health.some(entry => (CAPTURE_GAP_CODES as readonly string[]).includes(entry.code))
    ) {
      warnings.add('tool_activity_uncaptured');
    }
  }
  return [...warnings];
}

/**
 * Resolve an objective id or display id and require it to belong to the already
 * authorized mission, so a foreign objective can never select another mission's
 * rows. An exact stored id inside the mission wins; display forms go through the
 * shared resolver, which scopes by mission as well.
 */
async function resolveObjectiveInMission({
  ctx,
  missionId,
  ref
}: {
  ctx: ServiceContext;
  missionId: string;
  ref: string;
}): Promise<{ id: string }> {
  const exact = await ctx.db.get<{ id: string }>(
    `SELECT id FROM objectives
      WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [ref, missionId, ctx.workspace.id]
  );
  if (exact) return exact;
  const resolved = await resolveObjectiveRef({ ctx, ref, missionId });
  if (resolved.missionId !== missionId) {
    throw new ServiceError(
      'Objective does not belong to the addressed mission',
      'objective_mismatch',
      409
    );
  }
  return resolved;
}

/**
 * Synchronized changed-path evidence for exactly one objective of the addressed
 * mission. The objective is validated against the mission first and filters in
 * SQL before the count and the 200-row cap, so a busy sibling objective can
 * never crowd out or falsely empty this one. Unsynchronized local evidence is
 * invisible here by design.
 */
export async function listObjectiveFileChanges({
  ctx,
  missionId,
  objectiveId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId: string;
}): Promise<ObjectiveFileChangesDto> {
  const mission = await resolveMissionId(ctx, missionId);
  if (!objectiveId?.trim()) {
    throw new ServiceError('objectiveId is required', 'validation_error', 400);
  }
  const objective = await resolveObjectiveInMission({
    ctx,
    missionId: mission.id,
    ref: objectiveId
  });

  const countRow = (await ctx.db.get(
    `SELECT COUNT(*) AS total FROM changed_files
      WHERE objective_id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [objective.id, mission.id, ctx.workspace.id]
  )) as { total: number | string | bigint } | undefined;
  const rows = (await ctx.db.all(
    `SELECT cf.id, cf.mission_id, cf.objective_id, cf.file_path, cf.source, cf.hook_health,
            cf.last_observed_at, COALESCE(pr.resource_key, o.resource_key) AS resource_key
       FROM changed_files cf
       LEFT JOIN objectives o ON o.id = cf.objective_id AND o.deleted_at IS NULL
       LEFT JOIN project_resources pr ON pr.id = cf.resource_id AND pr.deleted_at IS NULL
      WHERE cf.objective_id = ? AND cf.mission_id = ? AND cf.workspace_id = ?
        AND cf.deleted_at IS NULL
      ORDER BY COALESCE(pr.resource_key, o.resource_key, '') ASC, cf.file_path ASC, cf.id ASC
      LIMIT ?`,
    [objective.id, mission.id, ctx.workspace.id, OBJECTIVE_FILE_CHANGES_LIMIT]
  )) as FileChangeRow[];
  const total = Number(countRow?.total ?? 0);

  const sessionRows = (await ctx.db.all(
    `SELECT id, started_at, capture_binding_state, capture_callback_observed_at, capture_health_json
       FROM agent_sessions
      WHERE objective_id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
      ORDER BY started_at ASC, id ASC`,
    [objective.id, mission.id, ctx.workspace.id]
  )) as CaptureSessionRow[];
  const sessions: CaptureSessionDto[] = sessionRows.map(row => ({
    sessionId: row.id,
    startedAt: toIso(row.started_at),
    bindingState: toBindingState(row.capture_binding_state),
    callbackObservedAt: row.capture_callback_observed_at
      ? toIso(row.capture_callback_observed_at)
      : null,
    health: readHealth(row.capture_health_json)
  }));

  const items: FileChangeDto[] = rows.map(row => ({
    id: row.id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    resourceKey: row.resource_key?.trim() || null,
    filePath: row.file_path,
    source: toSource(row.source),
    observedAt: toIso(row.last_observed_at),
    hookHealth: row.hook_health
  }));

  return {
    scope: 'server_objective',
    missionId: mission.id,
    objectiveId: objective.id,
    items,
    total,
    limit: OBJECTIVE_FILE_CHANGES_LIMIT,
    truncated: total > items.length,
    capture: { sessions, warnings: deriveCaptureWarnings(sessions) }
  };
}
