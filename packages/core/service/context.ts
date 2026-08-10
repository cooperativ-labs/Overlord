import { type DatabaseClient } from '@overlord/database';

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
