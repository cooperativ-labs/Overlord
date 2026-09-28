import { PERMISSIONS } from '@overlord/auth';

import { type ServiceContext } from '../../packages/core/service/context.ts';
import { registerActingExecutionTarget } from '../../packages/core/service/project-execution-target.ts';
import {
  createProject as createProjectService,
  discoverProject,
  listProjectStatuses
} from '../../packages/core/service/projects.ts';
import { authStatus } from '../../packages/core/service/protocol.ts';
import { buildWebappServiceContextForWorkspace, serviceDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireWorkspacePermission } from '../rbac.ts';
import { callerWorkspaceMemberships } from '../repository.ts';
import { listWorkspaces } from '../workspaces.ts';

import { type ProtocolRequestBody, requireFlag, strFlag, type SubcommandTable } from './flags.ts';

// ---- Auth, project, and workspace protocol subcommands --------------------
//
// Auth status, project discovery and creation, board statuses, and
// execution-target registration, spread into the dispatch table in
// backend/protocol.ts.

// ---- parentless workspace resolution -------------------------------------

type WorkspaceChoice = { id: string; name: string; slug: string };

type ParentlessWorkspaceResolution =
  | { kind: 'selection'; result: unknown }
  | { kind: 'workspace'; workspace: WorkspaceChoice };

/**
 * Resolve the target workspace for a "parentless" protocol action — one where
 * no mission/project/session reference identifies the workspace (project and
 * execution-target creation). When the caller belongs to more than one
 * workspace and did not name one via `--workspace-id`, this returns a structured
 * `workspace_selection_required` result listing the caller's workspaces instead
 * of silently defaulting; the agent/UI must ask the user and retry. Per-target
 * RBAC stays in the caller so the selection flow runs before any permission
 * check binds to a default workspace.
 */
async function resolveParentlessWorkspace(
  body: ProtocolRequestBody,
  selectionMessage: string
): Promise<ParentlessWorkspaceResolution> {
  const memberships = await callerWorkspaceMemberships();
  if (memberships.length === 0) {
    throw new ApiError(403, 'No active workspace membership; create or join a workspace first.');
  }

  const memberWorkspaceIds = new Set(memberships.map(m => m.workspaceId));
  const workspaces: WorkspaceChoice[] = (await listWorkspaces())
    .filter(w => memberWorkspaceIds.has(w.id))
    .map(w => ({ id: w.id, name: w.name, slug: w.slug }));

  const requested = strFlag(body, '--workspace-id')?.trim();
  if (requested) {
    const needle = requested.toLowerCase();
    const target = workspaces.find(
      w => w.id === requested || w.slug.toLowerCase() === needle || w.name.toLowerCase() === needle
    );
    if (!target) {
      throw new ApiError(404, `Workspace not found or not a member: ${requested}`);
    }
    return { kind: 'workspace', workspace: target };
  }
  if (workspaces.length === 1) {
    return { kind: 'workspace', workspace: workspaces[0]! };
  }
  return {
    kind: 'selection',
    result: {
      status: 'workspace_selection_required',
      message: selectionMessage,
      workspaces
    }
  };
}

/**
 * Create a project over the protocol/MCP surface. Project creation is
 * "parentless" (see {@link resolveParentlessWorkspace}).
 */
async function createProjectFromProtocol(body: ProtocolRequestBody): Promise<unknown> {
  const name = requireFlag(body, '--name');
  const resolved = await resolveParentlessWorkspace(
    body,
    'You belong to more than one workspace. Ask the user which workspace to create the ' +
      'project in, then retry with workspaceId set to the chosen id, slug, or name.'
  );
  if (resolved.kind === 'selection') return resolved.result;
  const target = resolved.workspace;

  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: target.id,
    permission: PERMISSIONS.PROJECT_CREATE,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const ctx: ServiceContext = {
    ...(await buildWebappServiceContextForWorkspace(
      target.id,
      serviceDatabaseClient(),
      workspaceUserId
    )),
    source: 'protocol'
  };
  const project = await createProjectService({
    ctx,
    name,
    description: strFlag(body, '--description') ?? null,
    slug: strFlag(body, '--slug') ?? null
  });
  return { status: 'created', project, workspace: target };
}

/**
 * Register (announce) the acting machine as an execution target over the
 * protocol/MCP surface. Like project creation this is "parentless" — the target
 * belongs to a workspace with no mission/project to derive it from — so it reuses
 * {@link resolveParentlessWorkspace} for the multi-workspace selection flow.
 * `execution_request:claim` (in the `mission_lifecycle` token scope) gates it, so
 * a runner/agent that will actually run executions can self-register, while the
 * per-target check runs after the workspace is chosen.
 */
async function registerTargetFromProtocol(body: ProtocolRequestBody): Promise<unknown> {
  const resolved = await resolveParentlessWorkspace(
    body,
    'You belong to more than one workspace. Ask the user which workspace to register the ' +
      'execution target in, then retry with workspaceId set to the chosen id, slug, or name.'
  );
  if (resolved.kind === 'selection') return resolved.result;
  const target = resolved.workspace;

  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: target.id,
    permission: PERMISSIONS.EXECUTION_REQUEST_CLAIM,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const ctx: ServiceContext = {
    ...(await buildWebappServiceContextForWorkspace(
      target.id,
      serviceDatabaseClient(),
      workspaceUserId
    )),
    source: 'protocol'
  };
  const registered = await registerActingExecutionTarget({
    ctx,
    label: strFlag(body, '--name') ?? null
  });
  return { status: 'registered', executionTarget: registered, workspace: target };
}

export const projectSubcommands: SubcommandTable = {
  // Auth and discovery -----------------------------------------------------
  'auth-status': {
    // Intentionally ungated so any authenticated actor can check who it is.
    permission: null,
    handler: ctx => authStatus({ ctx })
  },

  'discover-project': {
    permission: PERMISSIONS.PROJECT_READ,
    handler: (ctx, body) =>
      discoverProject({
        ctx,
        projectId: strFlag(body, '--project-id') ?? null,
        workingDirectory: strFlag(body, '--directory') ?? null
      })
  },

  // Board-column discovery. Statuses are project-scoped (coo:752), so an agent
  // that needs to name a column must ask the project that owns it. Read-only:
  // status *definitions* are edited in project settings, never over the protocol.
  statuses: {
    permission: PERMISSIONS.PROJECT_READ,
    handler: (ctx, body) =>
      listProjectStatuses({
        ctx,
        projectId: requireFlag(body, '--project-id')
      })
  },

  // Parentless project creation. Resolves/validates the target workspace itself
  // (see `createProjectFromProtocol`) so it can return a `workspace_selection_required`
  // result when the caller has multiple memberships instead of defaulting.
  'create-project': {
    // Enforced per-target inside the handler (requireWorkspacePermission) so the
    // multi-workspace selection flow runs before any default-workspace gate.
    permission: null,
    handler: (_ctx, body) => createProjectFromProtocol(body)
  },

  // Parentless execution-target registration. Resolves/validates the target
  // workspace itself (see `registerTargetFromProtocol`) so it can return a
  // `workspace_selection_required` result when the caller has multiple
  // memberships instead of defaulting.
  'register-target': {
    // Enforced per-target inside the handler, as for create-project.
    permission: null,
    handler: (_ctx, body) => registerTargetFromProtocol(body)
  },

  // Predates the real `organizations` table/hierarchy (coo:135) — despite the
  // name, this returns only the caller's current *workspace* context (never
  // an organization row), kept as-is to avoid a breaking protocol rename.
  // Use `GET /api/organizations` (web) for real organization data.
  'list-organizations': {
    permission: PERMISSIONS.PROJECT_READ,
    handler: ctx => [{ id: ctx.workspace.id, slug: ctx.workspace.slug, name: ctx.workspace.name }]
  }
};
