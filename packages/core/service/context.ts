import {
  type DatabaseClient,
  formatObjectiveDisplayId,
  parseObjectiveRef
} from '@overlord/database';

import type { ClientDeviceIdentity } from './device-identity.js';
import { ServiceError } from './errors.js';

export type WorkspaceContext = {
  id: string;
  slug: string;
  name: string;
};

export type { ClientDeviceIdentity } from './device-identity.js';

/** Who authored rows written through a service context. */
export type CreationOrigin = {
  kind: 'human' | 'agent' | 'automation';
  /** Connector/agent identifier as supplied, e.g. `claude-code`, `hosted-mcp`. */
  agent?: string | null;
  /** `agent_sessions.id` when the creating call ran inside a live session. */
  sessionId?: string | null;
};

export type ServiceContext = {
  db: DatabaseClient;
  workspace: WorkspaceContext;
  actorWorkspaceUserId: string | null;
  source: 'cli' | 'protocol' | 'webapp' | 'runner';
  /**
   * User token the request authenticated with, when one did. Recorded on
   * change-feed rows so a token-driven write stays attributable to the token
   * and not just the member behind it. The CLI/protocol/service paths leave
   * this unset; the REST layer supplies the active token.
   */
  actorTokenId?: string | null;
  /** Client machine identity (browser/desktop/CLI). Required on hosted backends. */
  clientDevice?: ClientDeviceIdentity | null;
  /** Who authored rows written through this context. Defaults from `source`. */
  origin?: CreationOrigin;
};

/**
 * Resolve the creation provenance stamped onto mission/objective inserts.
 * An explicit `ctx.origin` always wins; otherwise protocol → agent, runner →
 * automation, everything else → human.
 */
export function resolveOrigin(ctx: ServiceContext): Required<CreationOrigin> {
  if (ctx.origin) {
    return { agent: null, sessionId: null, ...ctx.origin };
  }
  return {
    kind: ctx.source === 'protocol' ? 'agent' : ctx.source === 'runner' ? 'automation' : 'human',
    agent: null,
    sessionId: null
  };
}

export async function createServiceContext({
  db,
  source
}: {
  db: DatabaseClient;
  source: ServiceContext['source'];
}): Promise<ServiceContext> {
  const workspace = await db.get<WorkspaceContext>(
    `SELECT id, slug, name FROM workspaces
       WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`
  );

  if (!workspace) {
    throw new ServiceError(
      'No workspace found. Run `ovld init` and `yarn start:local` first.',
      'no_workspace',
      503
    );
  }

  const actor = await db.get<{ id: string }>(
    `SELECT id FROM workspace_users
       WHERE workspace_id = ? AND status = 'active' AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    [workspace.id]
  );

  return {
    db,
    workspace,
    actorWorkspaceUserId: actor?.id ?? null,
    source
  };
}

export async function resolveMissionId(
  ctx: ServiceContext,
  missionRef: string
): Promise<{ id: string; displayId: string; projectId: string }> {
  const byId = await ctx.db.get<{ id: string; display_id: string; project_id: string }>(
    `SELECT id, display_id, project_id FROM missions
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [missionRef, ctx.workspace.id]
  );

  if (byId) {
    return { id: byId.id, displayId: byId.display_id, projectId: byId.project_id };
  }

  const byDisplay = await ctx.db.get<{ id: string; display_id: string; project_id: string }>(
    `SELECT id, display_id, project_id FROM missions
       WHERE display_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [missionRef, ctx.workspace.id]
  );

  if (byDisplay) {
    return {
      id: byDisplay.id,
      displayId: byDisplay.display_id,
      projectId: byDisplay.project_id
    };
  }

  throw new ServiceError(`Mission not found: ${missionRef}`, 'mission_not_found', 404);
}

export async function resolveProjectId(ctx: ServiceContext, projectRef: string): Promise<string> {
  const byId = await ctx.db.get<{ id: string }>(
    `SELECT id FROM projects
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [projectRef, ctx.workspace.id]
  );
  if (byId) return byId.id;

  const bySlug = await ctx.db.get<{ id: string }>(
    `SELECT id FROM projects
       WHERE slug = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [projectRef, ctx.workspace.id]
  );
  if (bySlug) return bySlug.id;

  const byName = await ctx.db.get<{ id: string }>(
    `SELECT id FROM projects
       WHERE lower(name) = lower(?) AND workspace_id = ? AND deleted_at IS NULL`,
    [projectRef, ctx.workspace.id]
  );
  if (byName) return byName.id;

  throw new ServiceError(`Project not found: ${projectRef}`, 'project_not_found', 404);
}

export type ResolvedObjectiveRef = {
  id: string;
  displayId: string;
  displayKey: string;
  missionId: string;
  projectId: string;
  workspaceId: string;
};

function wrongSeparatorMessage(separator: ':' | '|' | '-'): string {
  const example =
    separator === ':' ? 'coo:756:k7xm' : separator === '|' ? 'coo:756|k7xm' : 'coo:756-k7xm';
  return `Objective display ids use a dot separator (coo:756.k7xm), not '${separator}' (${example}).`;
}

function missionIdAsObjectiveMessage(missionDisplayId: string): string {
  return `${missionDisplayId} is a mission id. Pass a full objective display id (${missionDisplayId}.k7xm) or launch the mission.`;
}

/**
 * Resolve an objective UUID, `{mission.display_id}.{display_key}` public id, or
 * (when `missionId` is already known) a bare 4-character display key.
 *
 * UUID lookup is workspace-scoped by default, matching `resolveMissionId`.
 * REST callers that resolve globally by UUID (coo:135) pass
 * `uuidWorkspaceScoped: false`.
 */
export async function resolveObjectiveRef({
  ctx,
  ref,
  missionId,
  uuidWorkspaceScoped = true
}: {
  ctx: ServiceContext;
  ref: string;
  missionId?: string;
  uuidWorkspaceScoped?: boolean;
}): Promise<ResolvedObjectiveRef> {
  const parsed = parseObjectiveRef(ref);

  if (parsed.kind === 'wrong_separator') {
    throw new ServiceError(wrongSeparatorMessage(parsed.separator), 'invalid_objective_ref', 400);
  }
  if (parsed.kind === 'mission_id') {
    throw new ServiceError(
      missionIdAsObjectiveMessage(parsed.missionDisplayId),
      'invalid_objective_ref',
      400
    );
  }
  if (parsed.kind === 'unknown') {
    throw new ServiceError(`Objective not found: ${ref}`, 'objective_not_found', 404);
  }

  let scopedMissionId: string | undefined;
  if (missionId) {
    scopedMissionId = (await resolveMissionId(ctx, missionId)).id;
  }

  if (parsed.kind === 'display_key') {
    if (!scopedMissionId) {
      throw new ServiceError(
        'Pass a full objective display id (coo:756.k7xm), not a bare key.',
        'invalid_objective_ref',
        400
      );
    }
    return loadObjectiveByKey({
      ctx,
      missionId: scopedMissionId,
      displayKey: parsed.displayKey,
      ref
    });
  }

  if (parsed.kind === 'uuid') {
    const byId = await ctx.db.get<{
      id: string;
      mission_id: string;
      project_id: string;
      workspace_id: string;
      display_key: string;
      mission_display_id: string;
    }>(
      uuidWorkspaceScoped
        ? `SELECT o.id, o.mission_id, o.project_id, o.workspace_id, o.display_key,
                  m.display_id AS mission_display_id
             FROM objectives o
             JOIN missions m ON m.id = o.mission_id
            WHERE o.id = ? AND o.workspace_id = ? AND o.deleted_at IS NULL`
        : `SELECT o.id, o.mission_id, o.project_id, o.workspace_id, o.display_key,
                  m.display_id AS mission_display_id
             FROM objectives o
             JOIN missions m ON m.id = o.mission_id
            WHERE o.id = ? AND o.deleted_at IS NULL`,
      uuidWorkspaceScoped ? [parsed.id, ctx.workspace.id] : [parsed.id]
    );
    if (!byId) {
      throw new ServiceError(`Objective not found: ${ref}`, 'objective_not_found', 404);
    }
    if (scopedMissionId && byId.mission_id !== scopedMissionId) {
      throw new ServiceError(
        `Objective ${ref} does not belong to the given mission`,
        'invalid_objective_ref',
        400
      );
    }
    return {
      id: byId.id,
      displayKey: byId.display_key,
      displayId: formatObjectiveDisplayId({
        missionDisplayId: byId.mission_display_id,
        displayKey: byId.display_key
      }),
      missionId: byId.mission_id,
      projectId: byId.project_id,
      workspaceId: byId.workspace_id
    };
  }

  const mission = await ctx.db.get<{ id: string; display_id: string; project_id: string }>(
    `SELECT id, display_id, project_id FROM missions
       WHERE display_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [parsed.missionDisplayId, ctx.workspace.id]
  );
  if (!mission) {
    throw new ServiceError(`Objective not found: ${ref}`, 'objective_not_found', 404);
  }
  if (scopedMissionId && mission.id !== scopedMissionId) {
    throw new ServiceError(
      `Objective ${ref} does not belong to the given mission`,
      'invalid_objective_ref',
      400
    );
  }
  return loadObjectiveByKey({
    ctx,
    missionId: mission.id,
    displayKey: parsed.displayKey,
    ref,
    missionDisplayId: mission.display_id,
    projectId: mission.project_id
  });
}

async function loadObjectiveByKey({
  ctx,
  missionId,
  displayKey,
  ref,
  missionDisplayId,
  projectId
}: {
  ctx: ServiceContext;
  missionId: string;
  displayKey: string;
  ref: string;
  missionDisplayId?: string;
  projectId?: string;
}): Promise<ResolvedObjectiveRef> {
  const row = await ctx.db.get<{
    id: string;
    mission_id: string;
    project_id: string;
    workspace_id: string;
    display_key: string;
    mission_display_id: string;
  }>(
    `SELECT o.id, o.mission_id, o.project_id, o.workspace_id, o.display_key,
            m.display_id AS mission_display_id
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id
      WHERE o.mission_id = ? AND o.workspace_id = ? AND o.display_key = ?
        AND o.deleted_at IS NULL`,
    [missionId, ctx.workspace.id, displayKey]
  );
  if (!row) {
    throw new ServiceError(`Objective not found: ${ref}`, 'objective_not_found', 404);
  }
  const resolvedDisplayId = missionDisplayId ?? row.mission_display_id;
  return {
    id: row.id,
    displayKey: row.display_key,
    displayId: formatObjectiveDisplayId({
      missionDisplayId: resolvedDisplayId,
      displayKey: row.display_key
    }),
    missionId: row.mission_id,
    projectId: projectId ?? row.project_id,
    workspaceId: row.workspace_id
  };
}
