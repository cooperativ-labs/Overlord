import { type Permission, PERMISSIONS } from '@overlord/auth';

import { resolveObjectiveRef, type ServiceContext } from '../packages/core/service/context.ts';

import {
  deriveProtocolWorkspaceId,
  type ProtocolAddress,
  readProtocolAddress
} from './protocol/addressing.ts';
import { artifactSubcommands } from './protocol/artifacts.ts';
import {
  type ProtocolRequestBody,
  type SubcommandTable
} from './protocol/flags.ts';
import { missionSubcommands } from './protocol/missions.ts';
import { ProjectSelectionRequiredError } from './protocol/project-refs.ts';
import { projectSubcommands } from './protocol/projects.ts';
import { runQueueSubcommands } from './protocol/run-queue.ts';
import { sessionSubcommands } from './protocol/session.ts';
import {
  buildWebappServiceContext,
  buildWebappServiceContextForWorkspace,
  getActiveTokenProjectIds,
  getAuthorizedWorkspacesContext,
  serviceDatabaseClient
} from './db.ts';
import { ApiError } from './errors.ts';
import { actorCan } from './rbac.ts';
import {
  requireAnyWorkspacePermission,
  requirePermission,
  requireWorkspacePermission
} from './rbac.ts';
import { callerWorkspaceMemberships } from './repository.ts';

export type { ProtocolRequestBody } from './protocol/flags.ts';

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

async function buildProtocolContext(
  address: ProtocolAddress,
  permission: Permission | null
): Promise<ServiceContext> {
  const scopes = await callerWorkspaceMemberships();
  const workspaceId = await deriveProtocolWorkspaceId(
    address,
    scopes.map(scope => scope.workspaceId)
  );
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
  address,
  subcommand
}: {
  ctx: ServiceContext;
  address: ProtocolAddress;
  subcommand: string;
}): Promise<void> {
  // update-objective is addressed by an objective alone and deliberately has
  // no mission scope to validate against.
  if (subcommand === 'update-objective') return;
  const { objectiveRef, missionRef } = address;
  if (!objectiveRef || !missionRef) return;
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
  const address = readProtocolAddress(body);
  if (
    getActiveTokenProjectIds() !== null &&
    !new Set([
      'create',
      'load-context',
      'search',
      'discover-project',
      'statuses',
      'list-deliveries',
      'objective-changes',
      'attachment-list',
      'attachment-download-url',
      'auth-status'
    ]).has(subcommand)
  ) {
    throw new ApiError(404, 'Not found');
  }
  if (
    getActiveTokenProjectIds() !== null &&
    subcommand === 'discover-project' &&
    !address.projectRef
  ) {
    throw new ApiError(404, 'Not found');
  }
  const entry = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : undefined;
  if (!entry) {
    throw new ApiError(
      404,
      `Unknown protocol subcommand: ${subcommand}`,
      `Supported subcommands: ${Object.keys(SUBCOMMANDS).sort().join(', ')}`
    );
  }
  // Search (v2, v3 and an exact --reference lookup; v1 is retired, ADR 0054)
  // authorizes mission:read per workspace inside the repository fan-out, or per
  // project for --reference (v155). A single ambient workspace check would deny
  // valid secondary workspaces and reintroduce the pre-v95 scoping bug.
  const requiredPermission = subcommand === 'search' ? null : entry.permission;
  try {
    const ctx = await buildProtocolContext(address, requiredPermission);
    await validateObjectiveAddressing({ ctx, address, subcommand });
    ctx.canUpdateMissionItems = () =>
      actorCan(PERMISSIONS.MISSION_UPDATE, {
        workspaceId: ctx.workspace.id,
        workspaceUserId: ctx.actorWorkspaceUserId
      });
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
