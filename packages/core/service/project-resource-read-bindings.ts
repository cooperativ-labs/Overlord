import { defaultAuthorizer, makeActor, PERMISSIONS, type Role } from '@overlord/auth';
import {
  PROJECT_RESOURCE_READ_CAPABILITY,
  type ProjectResourceReadCatalog,
  type ProjectResourceReadRequest
} from '@overlord/contract';
import path from 'node:path';

import type { ServiceContext } from './context.ts';
import { RUNNER_HEARTBEAT_STALE_MS } from './execution-target-runners.ts';
import { asRecord, parseMetadataJson } from './records.ts';

export const READ_PROJECT_RESOURCE = 'readProjectResource';
export const PROJECT_RESOURCE_READ_JOB_KEY = 'project-resource-read';
export const PROJECT_RESOURCE_READ_TIMEOUT_MS = 30_000;

export async function listProjectResourceReadCatalog(
  ctx: ServiceContext,
  projectId: string
): Promise<ProjectResourceReadCatalog> {
  const rows = (await ctx.db.all(
    `SELECT pr.id AS resource_id, pr.resource_key, pr.label,
            CASE WHEN EXISTS (
              SELECT 1 FROM project_resource_sources git
               WHERE git.resource_id = pr.id AND git.project_id = pr.project_id
                 AND git.workspace_id = pr.workspace_id AND git.deleted_at IS NULL
                 AND git.source_kind = 'git' AND git.execution_target_id IS NULL
            ) THEN 1 ELSE 0 END AS has_git,
            s.id AS source_id, s.revision AS source_revision, t.id AS target_id, t.label AS target_label
       FROM project_resources pr
       LEFT JOIN (
         project_resource_sources s
         JOIN execution_targets t
           ON t.id = s.execution_target_id AND t.workspace_id = s.workspace_id
          AND t.type = 'local' AND t.status = 'active' AND t.deleted_at IS NULL
         JOIN workspace_user_execution_targets access
           ON access.execution_target_id = t.id AND access.workspace_id = t.workspace_id
          AND access.workspace_user_id = ? AND access.access_status = 'active'
          AND access.deleted_at IS NULL
         JOIN workspace_users member
           ON member.id = access.workspace_user_id AND member.workspace_id = t.workspace_id
          AND member.status = 'active' AND member.deleted_at IS NULL
       ) ON s.resource_id = pr.id AND s.project_id = pr.project_id
        AND s.workspace_id = pr.workspace_id AND s.source_kind = 'local_checkout'
        AND s.deleted_at IS NULL
      WHERE pr.workspace_id = ? AND pr.project_id = ? AND pr.deleted_at IS NULL
        AND pr.status <> 'archived'
      ORDER BY pr.resource_key, t.label, t.id`,
    [ctx.actorWorkspaceUserId, ctx.workspace.id, projectId]
  )) as Array<{
    resource_id: string;
    resource_key: string;
    label: string | null;
    has_git: number;
    source_id: string | null;
    source_revision: number | null;
    target_id: string | null;
    target_label: string | null;
  }>;

  const targetIds = [...new Set(rows.flatMap(row => (row.target_id ? [row.target_id] : [])))];
  const live = new Map<string, boolean>();
  if (targetIds.length > 0) {
    const registrations = (await ctx.db.all(
      `SELECT r.execution_target_id, r.capabilities_json
         FROM execution_target_runner_registrations r
        WHERE r.workspace_id = ? AND r.deleted_at IS NULL AND r.relation = 'native'
          AND r.health IN ('healthy', 'degraded') AND r.last_heartbeat_at >= ?
          AND r.execution_target_id IN (${targetIds.map(() => '?').join(', ')})`,
      [
        ctx.workspace.id,
        new Date(Date.now() - RUNNER_HEARTBEAT_STALE_MS).toISOString(),
        ...targetIds
      ]
    )) as Array<{ execution_target_id: string; capabilities_json: string | object }>;
    for (const registration of registrations) {
      const capabilities =
        typeof registration.capabilities_json === 'string'
          ? parseMetadataJson(registration.capabilities_json)
          : asRecord(registration.capabilities_json);
      const supported = capabilities[PROJECT_RESOURCE_READ_CAPABILITY] === true;
      live.set(
        registration.execution_target_id,
        supported || live.get(registration.execution_target_id) === true
      );
    }
  }

  const resources = new Map<string, ProjectResourceReadCatalog[number]>();
  for (const row of rows) {
    let resource = resources.get(row.resource_id);
    if (!resource) {
      resource = {
        id: row.resource_id,
        resourceKey: row.resource_key,
        label: row.label,
        hasGitSource: Boolean(row.has_git),
        sources: []
      };
      resources.set(row.resource_id, resource);
    }
    if (
      row.source_id &&
      row.source_revision !== null &&
      row.target_id &&
      row.target_label !== null
    ) {
      const supported = live.get(row.target_id);
      resource.sources.push({
        sourceId: row.source_id,
        sourceRevision: row.source_revision,
        executionTargetId: row.target_id,
        targetLabel: row.target_label,
        availability:
          supported === undefined ? 'target_offline' : supported ? 'ready' : 'unsupported'
      });
    }
  }
  return [...resources.values()];
}

export type ProjectResourceReadSource = Pick<
  ProjectResourceReadRequest,
  'sourceId' | 'sourceRevision' | 'executionTargetId' | 'resourceKey'
>;

export async function resolveProjectResourceReadSource({
  ctx,
  projectId,
  source,
  actor = ctx.actorWorkspaceUserId
}: {
  ctx: ServiceContext;
  projectId: string;
  source: ProjectResourceReadSource;
  actor?: string | null;
}): Promise<{ resourceId: string; repoPath: string } | null> {
  if (!actor) return null;
  const row = (await ctx.db.get(
    `SELECT pr.id AS resource_id, s.descriptor_json
       FROM project_resource_sources s
       JOIN projects p ON p.id = s.project_id AND p.workspace_id = s.workspace_id AND p.deleted_at IS NULL
       JOIN project_resources pr ON pr.id = s.resource_id AND pr.project_id = s.project_id
        AND pr.workspace_id = s.workspace_id AND pr.deleted_at IS NULL AND pr.status <> 'archived'
       JOIN execution_targets t ON t.id = s.execution_target_id AND t.workspace_id = s.workspace_id
        AND t.type = 'local' AND t.status = 'active' AND t.deleted_at IS NULL
       JOIN workspace_user_execution_targets access
         ON access.execution_target_id = t.id AND access.workspace_id = t.workspace_id
        AND access.workspace_user_id = ? AND access.access_status = 'active' AND access.deleted_at IS NULL
       JOIN workspace_users member
         ON member.id = access.workspace_user_id AND member.workspace_id = t.workspace_id
        AND member.status = 'active' AND member.deleted_at IS NULL
      WHERE s.workspace_id = ? AND s.project_id = ? AND pr.resource_key = ?
        AND s.execution_target_id = ? AND s.id = ? AND s.revision = ?
        AND s.source_kind = 'local_checkout' AND s.deleted_at IS NULL`,
    [
      actor,
      ctx.workspace.id,
      projectId,
      source.resourceKey,
      source.executionTargetId,
      source.sourceId,
      source.sourceRevision
    ]
  )) as { resource_id: string; descriptor_json: string | object } | undefined;
  if (!row) return null;
  // Queued reads can outlive the HTTP authorization snapshot.
  const roles = await ctx.db.all<{ role_key: Role }>(
    `SELECT role_key FROM role_assignments
      WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [ctx.workspace.id, actor]
  );
  if (
    !defaultAuthorizer.can(
      makeActor(
        actor,
        roles.map(row => row.role_key)
      ),
      PERMISSIONS.PROJECT_READ
    ).allowed
  ) {
    return null;
  }
  const descriptor =
    typeof row.descriptor_json === 'string'
      ? parseMetadataJson(row.descriptor_json)
      : asRecord(row.descriptor_json);
  return typeof descriptor.path === 'string' &&
    (path.posix.isAbsolute(descriptor.path) || path.win32.isAbsolute(descriptor.path))
    ? { resourceId: row.resource_id, repoPath: descriptor.path }
    : null;
}
