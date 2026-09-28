import { type Permission } from '@overlord/auth';
import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';

import { resolveObjectiveRef, type ServiceContext } from '../packages/core/service/context.ts';
import { hashSessionKey } from '../packages/core/service/util.ts';

import { artifactSubcommands } from './protocol/artifacts.ts';
import {
  intFlag,
  objectiveRefFlag,
  type ProtocolRequestBody,
  strFlag,
  type SubcommandTable
} from './protocol/flags.ts';
import { missionSubcommands } from './protocol/missions.ts';
import {
  ProjectSelectionRequiredError,
  resolveProjectRefChoices
} from './protocol/project-refs.ts';
import { projectSubcommands } from './protocol/projects.ts';
import { runQueueSubcommands } from './protocol/run-queue.ts';
import { sessionSubcommands } from './protocol/session.ts';
import {
  buildWebappServiceContext,
  buildWebappServiceContextForWorkspace,
  getActiveTokenProjectIds,
  getAuthorizedWorkspacesContext,
  projectInTokenScope,
  serviceDatabaseClient
} from './db.ts';
import { ApiError } from './errors.ts';
import {
  requireAnyWorkspacePermission,
  requirePermission,
  requireWorkspacePermission
} from './rbac.ts';
import { callerWorkspaceMemberships } from './repository.ts';

export type { ProtocolRequestBody } from './protocol/flags.ts';
export { type ProjectChoice, ProjectSelectionRequiredError } from './protocol/project-refs.ts';

// ---- Protocol command dispatch -------------------------------------------
//
// The published npm CLI is client-only: `ovld protocol <subcommand>` forwards
// to `POST /api/protocol/<subcommand>` carrying the parsed flags/positional
// arguments and per-flag file payloads. This module turns that envelope back
// into a service-layer call shared with the rest of Overlord.
//
// Subcommand handlers live in grouped modules under ./protocol/; each group
// exports a table of `{ handler, permission }` entries that is merged below.
// Shared flag helpers live in ./protocol/flags.ts, which imports nothing from
// this file.

async function protocolWorkspaceId(body: ProtocolRequestBody): Promise<string | null> {
  const scopes = await callerWorkspaceMemberships();
  if (scopes.length === 0) return null;
  const workspaceIds = scopes.map(scope => scope.workspaceId);
  const placeholders = workspaceIds.map(() => '?').join(', ');
  const db = serviceDatabaseClient();

  const executionRequestId = strFlag(body, '--execution-request-id');
  if (executionRequestId) {
    const request = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM execution_requests
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [executionRequestId, ...workspaceIds]
    );
    if (request) return request.workspace_id;
  }

  const sessionKey = strFlag(body, '--session-key');
  if (sessionKey) {
    const session = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM agent_sessions
        WHERE session_key_hash = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [hashSessionKey(sessionKey), ...workspaceIds]
    );
    if (session) return session.workspace_id;
  }

  // `--objective-id` alone is a complete address, so it has to resolve a
  // workspace on its own: a UUID identifies the objective row directly, and a
  // display id falls through to the mission lookup below via `missionRefFlag`.
  const objectiveRef = strFlag(body, '--objective-id');
  if (objectiveRef) {
    const objective = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM objectives
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [objectiveRef, ...workspaceIds]
    );
    if (objective) return objective.workspace_id;
  }

  const missionRef =
    strFlag(body, '--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef) ?? undefined;
  if (missionRef) {
    const byId = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM missions
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [missionRef, ...workspaceIds]
    );
    if (byId) return byId.workspace_id;

    const byDisplay = await db.all<{ workspace_id: string; project_id: string }>(
      `SELECT workspace_id, project_id FROM missions
        WHERE display_id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [missionRef, ...workspaceIds]
    );
    const visible = byDisplay.filter(row => projectInTokenScope(row.project_id));
    if (visible.length > 1) {
      throw new ApiError(409, `Mission reference is ambiguous across workspaces: ${missionRef}`);
    }
    if (visible[0]) return visible[0].workspace_id;
  }

  // Human project references (slug/name) are unique per workspace only, so this
  // is the one derivation step that can legitimately be ambiguous. Ambiguity is
  // reported as a selection result rather than an error so an agent can ask the
  // user and retry with `--workspace-id`.
  const projectRef = strFlag(body, '--project-id');
  if (!projectRef) return null;
  const choices = await resolveProjectRefChoices({
    projectRef,
    workspaceHint: strFlag(body, '--workspace-id'),
    workspaceIds
  });
  if (choices.length > 1) throw new ProjectSelectionRequiredError(projectRef, choices);
  return choices[0]?.workspaceId ?? null;
}

async function buildProtocolContext(
  body: ProtocolRequestBody,
  permission: Permission | null
): Promise<ServiceContext> {
  const workspaceId = await protocolWorkspaceId(body);
  if (!workspaceId) {
    const authorized = getAuthorizedWorkspacesContext();
    if (authorized) {
      const scope = permission
        ? await requireAnyWorkspacePermission(permission)
        : [...authorized.workspaces].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))[0];
      if (!scope) throw new ApiError(404, 'Workspace not found');
      const ctx = await buildWebappServiceContextForWorkspace(
        scope.workspaceId,
        serviceDatabaseClient(),
        scope.workspaceUserId
      );
      // Aggregate/account-owned protocol handlers require ServiceContext for
      // the shared service signature, but authorization/fan-out remains inside
      // the handler. This deterministic anchor is never an ambient default.
      return { ...ctx, source: 'protocol' };
    }
    // Direct service tests and the loopback bootstrap surface have no request
    // authorization snapshot, so they resolve their process-local context here.
    const ctx = buildWebappServiceContext();
    if (permission) {
      await requirePermission(permission, {
        workspaceId: ctx.workspace.id,
        workspaceUserId: ctx.actorWorkspaceUserId
      });
    }
    return { ...ctx, source: 'protocol' };
  }
  const workspaceUserId = permission
    ? await requireWorkspacePermission({ workspaceId, permission })
    : (await callerWorkspaceMemberships()).find(scope => scope.workspaceId === workspaceId)
        ?.workspaceUserId;
  if (!workspaceUserId) throw new ApiError(404, 'Workspace not found');
  const ctx = await buildWebappServiceContextForWorkspace(
    workspaceId,
    serviceDatabaseClient(),
    workspaceUserId
  );
  return { ...ctx, source: 'protocol' };
}

/** Validate the mission/objective pair even when a command uses the objective only as scope. */
async function validateObjectiveAddressing({
  ctx,
  body,
  subcommand
}: {
  ctx: ServiceContext;
  body: ProtocolRequestBody;
  subcommand: string;
}): Promise<void> {
  // update-objective is addressed by an objective alone and deliberately has
  // no mission scope to validate against.
  if (subcommand === 'update-objective') return;
  const objectiveRef = objectiveRefFlag(body);
  if (!objectiveRef) return;
  const missionRef =
    strFlag(body, '--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef);
  if (!missionRef) return;
  await resolveObjectiveRef({ ctx, ref: objectiveRef, missionId: missionRef });
}

// ---- subcommand table ----------------------------------------------------

/** Merge subcommand groups, refusing a name registered by two groups. */
function mergeSubcommandTables(...tables: SubcommandTable[]): SubcommandTable {
  const merged: SubcommandTable = {};
  for (const table of tables) {
    for (const [name, entry] of Object.entries(table)) {
      if (name in merged) throw new Error(`Duplicate protocol subcommand: ${name}`);
      merged[name] = entry;
    }
  }
  return merged;
}

const SUBCOMMANDS = mergeSubcommandTables(
  sessionSubcommands,
  missionSubcommands,
  runQueueSubcommands,
  artifactSubcommands,
  projectSubcommands
);

/**
 * RBAC permission each protocol subcommand requires, derived from the dispatch
 * table. Enforced before dispatch so a scoped `USER_TOKEN` (and any
 * under-privileged actor) is rejected uniformly — the `mission_lifecycle` scope
 * grants exactly the set used here. `auth-status` is intentionally ungated so
 * any authenticated actor can check who it is.
 */
export const SUBCOMMAND_PERMISSIONS: Record<string, Permission | null> = Object.fromEntries(
  Object.entries(SUBCOMMANDS).map(([name, entry]) => [name, entry.permission])
);

/**
 * Dispatch a single `ovld protocol <subcommand>` invocation to the service
 * layer. Throws `ApiError(404)` for unknown subcommands; service-layer
 * validation surfaces as `ServiceError` (mapped to HTTP status by the caller).
 */
export async function runProtocolSubcommand(
  subcommand: string,
  body: ProtocolRequestBody
): Promise<unknown> {
  const canonicalSubcommand = subcommand === 'search' ? 'search-missions' : subcommand;
  if (
    getActiveTokenProjectIds() !== null &&
    !new Set([
      'create',
      'load-context',
      'search-missions',
      'discover-project',
      'statuses',
      'list-deliveries',
      'attachment-list',
      'attachment-download-url',
      'auth-status'
    ]).has(canonicalSubcommand)
  ) {
    throw new ApiError(404, 'Not found');
  }
  if (
    getActiveTokenProjectIds() !== null &&
    canonicalSubcommand === 'discover-project' &&
    !strFlag(body, '--project-id')
  ) {
    throw new ApiError(404, 'Not found');
  }
  const entry = Object.hasOwn(SUBCOMMANDS, canonicalSubcommand)
    ? SUBCOMMANDS[canonicalSubcommand]
    : undefined;
  if (!entry) {
    throw new ApiError(
      404,
      `Unknown protocol subcommand: ${subcommand}`,
      `Supported subcommands: ${Object.keys(SUBCOMMANDS).sort().join(', ')}`
    );
  }
  // V2 search authorizes mission:read per workspace inside the repository
  // fan-out. A single ambient workspace check would deny valid secondary
  // workspaces and reintroduce the pre-v95 scoping bug.
  const isAggregateSearch =
    canonicalSubcommand === 'search-missions' &&
    (intFlag(body, '--response-version') === 2 || intFlag(body, '--response-version') === 3);
  const requiredPermission = isAggregateSearch ? null : entry.permission;
  try {
    const ctx = await buildProtocolContext(body, requiredPermission);
    await validateObjectiveAddressing({ ctx, body, subcommand: canonicalSubcommand });
    return await entry.handler(ctx, body);
  } catch (error) {
    // A project name that matches in two workspaces is a question for the user,
    // not a failure. Mirrors `workspace_selection_required` on the parentless
    // creates: the caller asks, then retries with `--workspace-id`.
    if (error instanceof ProjectSelectionRequiredError) {
      return {
        status: 'project_selection_required',
        message:
          `More than one project matches "${error.projectRef}". Ask the user which workspace ` +
          'they mean, then retry with workspaceId set to the chosen workspace id, slug, or name.',
        projectRef: error.projectRef,
        projects: error.projects
      };
    }
    throw error;
  }
}
