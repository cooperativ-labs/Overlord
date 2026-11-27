import type {
  ProjectResourceSourceDto,
  UpdateProjectResourceLatchHostBody
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';

import { RunnerQueueProvider } from './local-target/runner-queue-provider.ts';
import { recordChange } from './change-feed.ts';
import { requireProjectInScope, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { RUNNER_HEARTBEAT_STALE_MS } from './execution-target-runners.ts';
import { isLatchHostPublicKey, latchHostKeyDigest } from './latch-host-identity.ts';
import { parseMetadataJson } from './records.ts';
import { newId, nowIso } from './util.ts';

type OwnedSource = {
  id: string;
  resource_id: string;
  resource_key: string;
  execution_target_id: string;
  revision: number;
  latch_host_binding_json: string | null;
  native_runners: number | string;
  live_native_runners: number | string;
  has_access: number | boolean;
};

async function loadOwnedSources({
  db,
  workspaceId,
  workspaceUserId,
  projectId,
  sourceId = null
}: {
  db: DatabaseClient;
  workspaceId: string;
  workspaceUserId: string;
  projectId: string;
  sourceId?: string | null;
}): Promise<OwnedSource[]> {
  const since = new Date(Date.now() - RUNNER_HEARTBEAT_STALE_MS).toISOString();
  return db.all<OwnedSource>(
    `SELECT source.id, source.resource_id, resource.resource_key, source.execution_target_id,
            source.revision, source.latch_host_binding_json,
            (SELECT COUNT(*) FROM execution_target_runner_registrations runner
              WHERE runner.workspace_id = target.workspace_id AND runner.execution_target_id = target.id
                AND runner.relation = 'native' AND runner.deleted_at IS NULL) AS native_runners,
            (SELECT COUNT(*) FROM execution_target_runner_registrations runner
              WHERE runner.workspace_id = target.workspace_id AND runner.execution_target_id = target.id
                AND runner.relation = 'native' AND runner.deleted_at IS NULL
                AND runner.health IN ('healthy', 'degraded') AND runner.last_heartbeat_at >= ?) AS live_native_runners,
            CASE WHEN target.status = 'active' AND EXISTS (
              SELECT 1 FROM workspace_user_execution_targets access
               WHERE access.execution_target_id = target.id AND access.workspace_id = target.workspace_id
                 AND access.workspace_user_id = target.owner_workspace_user_id
                 AND access.access_status = 'active' AND access.deleted_at IS NULL
            ) THEN 1 ELSE 0 END AS has_access
       FROM project_resource_sources source
       JOIN project_resources resource ON resource.id = source.resource_id
        AND resource.workspace_id = source.workspace_id AND resource.project_id = source.project_id
        AND resource.status = 'active' AND resource.deleted_at IS NULL
       JOIN projects project ON project.id = source.project_id
        AND project.workspace_id = source.workspace_id AND project.deleted_at IS NULL
       JOIN execution_targets target ON target.id = source.execution_target_id
        AND target.workspace_id = source.workspace_id AND target.type = 'local'
        AND target.deleted_at IS NULL AND target.owner_workspace_user_id = ?
       JOIN workspace_users owner ON owner.id = target.owner_workspace_user_id
        AND owner.workspace_id = source.workspace_id AND owner.status = 'active' AND owner.deleted_at IS NULL
       JOIN devices device ON device.id = target.device_id AND device.workspace_id = target.workspace_id
        AND device.deleted_at IS NULL AND device.status = 'active' AND device.platform <> 'browser'
      WHERE source.workspace_id = ? AND source.project_id = ?
        AND source.source_kind = 'local_checkout' AND source.deleted_at IS NULL
        ${sourceId ? 'AND source.id = ?' : ''}`,
    [since, workspaceUserId, workspaceId, projectId, ...(sourceId ? [sourceId] : [])]
  );
}

function currentHostKey(source: OwnedSource, workspaceUserId: string): string | null {
  const saved = parseMetadataJson(source.latch_host_binding_json ?? '{}');
  return saved.sourceRevision === source.revision &&
    saved.workspaceUserId === workspaceUserId &&
    isLatchHostPublicKey(saved.hostPublicKey)
    ? saved.hostPublicKey
    : null;
}

type LatchHostLink = NonNullable<ProjectResourceSourceDto['latchHostLink']>;

/** Project readers see only links for sources on their own actively granted targets. */
export async function loadProjectResourceLatchHosts(
  scope: Parameters<typeof loadOwnedSources>[0]
): Promise<Map<string, LatchHostLink>> {
  const sources = await loadOwnedSources(scope);
  const hostCounts = new Map<string, number>();
  for (const source of sources) {
    const key = currentHostKey(source, scope.workspaceUserId);
    if (!key || !source.has_access || Number(source.native_runners) === 0) continue;
    const group = `${source.resource_id}:${key}`;
    hostCounts.set(group, (hostCounts.get(group) ?? 0) + 1);
  }

  const links = new Map<string, LatchHostLink>();
  for (const source of sources) {
    const key = currentHostKey(source, scope.workspaceUserId);
    const canVerify = Boolean(source.has_access) && Number(source.live_native_runners) === 1;
    if (!source.has_access || Number(source.native_runners) === 0) continue;
    const ambiguous =
      Number(source.live_native_runners) > 1 ||
      Boolean(key && (hostCounts.get(`${source.resource_id}:${key}`) ?? 0) > 1);
    links.set(source.id, {
      sourceRevision: source.revision,
      state: ambiguous ? 'ambiguous' : key ? 'linked' : 'unlinked',
      canVerify,
      canUnlink: key !== null,
      ...(!ambiguous && key ? { hostPublicKey: key } : {})
    });
  }
  return links;
}

const IDEMPOTENCY_SCOPE = 'api.project-resource.latch-host';

function sourceConflict(): ServiceError {
  return new ServiceError(
    'The source changed. Refresh settings and try again.',
    'project_resource_source_conflict',
    409
  );
}

/** Called after the application authorizes project:update in the owning workspace. */
export async function setProjectResourceLatchHost({
  ctx,
  projectId,
  resourceId,
  sourceId,
  body,
  signal
}: {
  ctx: ServiceContext;
  projectId: string;
  resourceId: string;
  sourceId: string;
  body: UpdateProjectResourceLatchHostBody;
  signal?: AbortSignal;
}): Promise<{ ok: true }> {
  requireProjectInScope(ctx, projectId);
  const { db, actorWorkspaceUserId: workspaceUserId } = ctx;
  const workspaceId = ctx.workspace.id;
  const { hostPublicKey, sourceRevision } = body;
  const missing = () =>
    new ServiceError(
      'Eligible project resource source not found',
      'project_resource_source_not_found',
      404
    );
  if (!workspaceUserId) throw missing();
  if (hostPublicKey !== null && !isLatchHostPublicKey(hostPublicKey)) {
    throw new ServiceError('Invalid Latch host public key', 'invalid_latch_host_public_key');
  }

  const load = async (client: DatabaseClient) => {
    const [source] = await loadOwnedSources({
      workspaceId,
      workspaceUserId,
      db: client,
      projectId,
      sourceId
    });
    if (!source || source.resource_id !== resourceId) throw missing();
    return source;
  };
  const receiptKey = `${workspaceUserId}:${sourceId}:${sourceRevision}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify([projectId, resourceId, sourceId, sourceRevision, hostPublicKey]))
    .digest('hex');
  const accepted = async (client: DatabaseClient) =>
    Boolean(
      await client.get(
        `SELECT id FROM idempotency_keys
        WHERE workspace_id = ? AND scope = ? AND key = ? AND actor_workspace_user_id = ?
          AND request_hash = ? AND status = 'completed' AND expires_at > ?`,
        [workspaceId, IDEMPOTENCY_SCOPE, receiptKey, workspaceUserId, requestHash, nowIso()]
      )
    );
  const check = (source: OwnedSource) => {
    if (source.revision !== sourceRevision) throw sourceConflict();
    if (
      hostPublicKey !== null &&
      (!source.has_access || Number(source.live_native_runners) !== 1)
    ) {
      throw new ServiceError(
        'Host verification requires one active native runner on this target.',
        'latch_host_runner_unavailable',
        409
      );
    }
  };

  const source = await load(db);
  if (await accepted(db)) return { ok: true };
  check(source);
  if (hostPublicKey !== null) {
    const provider = new RunnerQueueProvider(
      {
        executionTargetId: source.execution_target_id,
        transport: 'runner_queue',
        deviceLabel: null
      },
      { ctx, projectId, resourceKey: source.resource_key, signal }
    );
    const result = await provider.readLatchHostIdentity();
    if (
      !result.ok ||
      result.value.hostKeyDigest !== latchHostKeyDigest(hostPublicKey) ||
      signal?.aborted
    ) {
      throw new ServiceError(
        'The native runner did not verify the expected Latch host key.',
        'latch_host_unverified',
        409
      );
    }
  }

  await db.transaction(async tx => {
    const current = await load(tx);
    if (await accepted(tx)) return;
    check(current);
    if (current.execution_target_id !== source.execution_target_id) throw sourceConflict();

    const now = nowIso();
    const saved =
      hostPublicKey === null
        ? null
        : JSON.stringify({
            hostPublicKey,
            sourceRevision: current.revision + 1,
            workspaceUserId
          });
    const update = await tx.run(
      `UPDATE project_resource_sources
          SET latch_host_binding_json = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [saved, now, sourceId, current.revision]
    );
    if (update.changes !== 1) {
      if (await accepted(tx)) return;
      throw sourceConflict();
    }
    const resource = await tx.get<{ revision: number }>(
      `UPDATE project_resources SET revision = revision + 1, updated_at = ?
        WHERE id = ? AND status = 'active' AND deleted_at IS NULL RETURNING revision`,
      [now, resourceId]
    );
    if (!resource) throw sourceConflict();
    await recordChange({
      ctx: { ...ctx, db: tx },
      entityType: 'project_resource',
      entityId: resourceId,
      entityRevision: resource.revision,
      operation: 'update',
      projectId,
      changedFields: ['sources.latch_host_binding']
    });
    await tx.run(
      `INSERT INTO idempotency_keys
          (id, workspace_id, scope, key, request_hash, status, actor_workspace_user_id, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
      [
        newId(),
        workspaceId,
        IDEMPOTENCY_SCOPE,
        receiptKey,
        requestHash,
        workspaceUserId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now
      ]
    );
  });
  return { ok: true };
}
