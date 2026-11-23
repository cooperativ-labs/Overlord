import { type Permission, PERMISSIONS } from '@overlord/auth';

import { resolveObjectiveRef, type ServiceContext } from '../packages/core/service/context.ts';

import {
  deriveProtocolWorkspaceId,
  type ProtocolAddress,
  readProtocolAddress
} from './protocol/addressing.ts';
import { artifactSubcommands } from './protocol/artifacts.ts';
import { type ProtocolRequestBody, type SubcommandTable } from './protocol/flags.ts';
import { missionSubcommands } from './protocol/missions.ts';
import { ProjectSelectionRequiredError } from './protocol/project-refs.ts';
import { projectSubcommands } from './protocol/projects.ts';
import { runQueueSubcommands } from './protocol/run-queue.ts';
import { searchSubcommands } from './protocol/search.ts';
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
// exports a table of subcommand entries that is merged below.
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
  address
}: {
  ctx: ServiceContext;
  address: ProtocolAddress;
}): Promise<void> {
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
  searchSubcommands,
  runQueueSubcommands,
  artifactSubcommands,
  projectSubcommands
);

/**
 * RBAC permission declared by each protocol subcommand. Entries can delegate
 * enforcement to the handler through `dispatchGate`.
 */
export const SUBCOMMAND_PERMISSIONS: Record<string, Permission | null> = Object.fromEntries(
  Object.entries(SUBCOMMANDS).map(([name, entry]) => [name, entry.permission])
);

/** Subcommands admitted by the HTTP route guard. Dispatch checks flag requirements. */
export const PROJECT_AUTOMATION_SUBCOMMANDS: readonly string[] = Object.entries(SUBCOMMANDS)
  .filter(([, entry]) => entry.projectAutomation !== 'denied')
  .map(([name]) => name);

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
  const entry = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : undefined;
  if (
    getActiveTokenProjectIds() !== null &&
    (!entry ||
      entry.projectAutomation === 'denied' ||
      (entry.projectAutomation === 'admitted-with-project-id' && !address.projectRef))
  ) {
    throw new ApiError(404, 'Not found');
  }
  if (!entry) {
    throw new ApiError(
      404,
      `Unknown protocol subcommand: ${subcommand}`,
      `Supported subcommands: ${Object.keys(SUBCOMMANDS).sort().join(', ')}`
    );
  }
  const requiredPermission = entry.dispatchGate === 'handler' ? null : entry.permission;
  try {
    const ctx = await buildProtocolContext(address, requiredPermission);
    if (entry.addressing !== 'objective-only') {
      await validateObjectiveAddressing({ ctx, address });
    }
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
