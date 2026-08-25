import { recordChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';
import {
  findActingDeviceTarget,
  type LocalExecutionTarget,
  NO_EXECUTION_TARGET_REGISTERED,
  resolveClaimingDeviceTarget
} from './execution-targets.js';
import { enqueueRunQueueDispatchForWorkspace } from './run-queue.js';
import { newId, nowIso } from './util.js';

/**
 * A local execution target is reachable while one of its runner instances has
 * reported healthy inside this window. Matches the existing device-liveness
 * window so the rollout does not change how quickly a target goes offline.
 */
export const RUNNER_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** Health values that count as "this runner can still take work". */
const LIVE_RUNNER_HEALTH = ['healthy', 'degraded'] as const;

/** No heartbeat inside the liveness window — the next one is a reconnect. */
function isStaleHeartbeat(lastHeartbeatAt: string | null, now: string): boolean {
  if (!lastHeartbeatAt) return true;
  const last = Date.parse(lastHeartbeatAt);
  const current = Date.parse(now);
  if (Number.isNaN(last) || Number.isNaN(current)) return true;
  return current - last > RUNNER_HEARTBEAT_STALE_MS;
}

/**
 * How a runner process relates to the execution target it serves.
 *
 * `native` — the runner is on the target's own machine.
 * `adopted` — the runner is a container sharing that machine's filesystem
 *   (AgentPod), serving the host's target rather than declaring its own.
 */
export type RunnerRelation = 'native' | 'adopted';

export function isRunnerRelation(value: unknown): value is RunnerRelation {
  return value === 'native' || value === 'adopted';
}

export type RunnerRegistrationInput = {
  /**
   * Explicit target to serve. An AgentPod passes its host's target id here. It
   * is resolved and authorized, never created.
   */
  executionTargetId?: string | null;
  runnerInstanceId?: string | null;
  relation?: RunnerRelation | null;
  label?: string | null;
  runnerVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
  supportedAgents?: string[] | null;
};

export type RunnerRegistration = {
  id: string;
  executionTargetId: string;
  runnerInstanceId: string;
  relation: RunnerRelation;
  label: string | null;
  runnerVersion: string | null;
  /** Non-secret operator diagnostic: agent binaries this runner reported. */
  supportedAgents: string[];
  health: string;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
};

type TargetRow = {
  id: string;
  device_id: string | null;
  type: string;
  status: string;
  label: string;
  fingerprint: string | null;
};

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && text.length > 0 ? text : null;
}

function notRegistered(message: string): ServiceError {
  return new ServiceError(message, NO_EXECUTION_TARGET_REGISTERED, 409);
}

/**
 * Resolve an explicitly named execution target the caller may serve.
 *
 * Every condition here is an authorization condition, not a convenience filter:
 * a runner may only serve a target that exists in this workspace, is a local
 * (device) target, is enabled, and is one the authenticated member already has
 * active access to. Failing any of them is reported as "no execution target is
 * registered for this runner" so a runner polling several workspaces treats it
 * the same as a machine it has not been declared on (contract v40).
 */
async function resolveExplicitTarget({
  ctx,
  executionTargetId
}: {
  ctx: ServiceContext;
  executionTargetId: string;
}): Promise<TargetRow> {
  const row = (await ctx.db.get(
    `SELECT et.id, et.device_id, et.type, et.status, et.label, d.fingerprint
       FROM execution_targets et
       LEFT JOIN devices d
         ON d.id = et.device_id
        AND d.workspace_id = et.workspace_id
        AND d.deleted_at IS NULL
      WHERE et.id = ? AND et.workspace_id = ? AND et.deleted_at IS NULL`,
    [executionTargetId, ctx.workspace.id]
  )) as TargetRow | undefined;

  if (!row) {
    throw notRegistered(
      `Execution target ${executionTargetId} does not exist in this workspace. A runner never creates one — register the machine with \`ovld add-et\` and pass its id.`
    );
  }
  if (row.type !== 'local') {
    throw notRegistered(
      `Execution target ${executionTargetId} is a ${row.type} target. Only local targets are served by a device runner.`
    );
  }
  if (row.status !== 'active') {
    throw notRegistered(
      `Execution target "${row.label}" is ${row.status}. Enable it before a runner can serve it.`
    );
  }
  if (!ctx.actorWorkspaceUserId) {
    throw notRegistered('This runner has no workspace membership to claim work with.');
  }
  const access = (await ctx.db.get(
    `SELECT id FROM workspace_user_execution_targets
        WHERE workspace_id = ? AND workspace_user_id = ? AND execution_target_id = ?
          AND access_status = 'active' AND deleted_at IS NULL`,
    [ctx.workspace.id, ctx.actorWorkspaceUserId, row.id]
  )) as { id: string } | undefined;
  if (!access) {
    throw notRegistered(
      `You do not have access to execution target "${row.label}", so this runner cannot serve it.`
    );
  }
  return row;
}

/**
 * Refuse a target a workspace administrator has disabled.
 *
 * `findActingDeviceTarget` deliberately ignores status — a disabled machine is
 * still the machine that wrote a launch preference or observed a branch — so the
 * enable/disable control only reaches claims if the runner path asserts it here.
 * Contract v41 requires both halves: disabled targets leave eligibility *and*
 * runners reject claims for them, whether the runner named the target explicitly
 * or resolved its own machine.
 */
async function assertTargetEnabled({
  ctx,
  executionTargetId
}: {
  ctx: ServiceContext;
  executionTargetId: string;
}): Promise<void> {
  const row = (await ctx.db.get(
    `SELECT status, label FROM execution_targets
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [executionTargetId, ctx.workspace.id]
  )) as { status: string; label: string } | undefined;
  if (row && row.status !== 'active') {
    throw notRegistered(
      `Execution target "${row.label}" is ${row.status}. Enable it before a runner can serve it.`
    );
  }
}

/**
 * The execution target this runner serves, plus the relation it has to it.
 *
 * Without an explicit id this is the acting machine's own already-declared
 * target (`native`). With one — how an AgentPod adopts its host — the named
 * target is authorized and the relation defaults to `adopted` unless that target
 * turns out to be the acting machine's own after all.
 *
 * Neither path ever creates a target.
 */
export async function resolveRunnerTarget({
  ctx,
  input,
  actingTarget
}: {
  ctx: ServiceContext;
  input: RunnerRegistrationInput;
  actingTarget?: LocalExecutionTarget | null;
}): Promise<{ executionTargetId: string; deviceId: string | null; relation: RunnerRelation }> {
  const explicitId = trimmed(input.executionTargetId);
  if (!explicitId) {
    // No explicit target: the acting machine must already be declared. This is
    // the path that fails with the actionable `ovld add-et` remedy.
    const target = actingTarget ?? (await resolveClaimingDeviceTarget({ ctx }));
    await assertTargetEnabled({ ctx, executionTargetId: target.executionTargetId });
    return {
      executionTargetId: target.executionTargetId,
      deviceId: target.deviceId,
      relation: input.relation ?? 'native'
    };
  }

  const row = await resolveExplicitTarget({ ctx, executionTargetId: explicitId });
  const acting = actingTarget === undefined ? await findActingDeviceTarget({ ctx }) : actingTarget;
  const isOwnMachine = acting !== null && acting?.executionTargetId === row.id;
  return {
    executionTargetId: row.id,
    deviceId: row.device_id,
    relation: input.relation ?? (isOwnMachine ? 'native' : 'adopted')
  };
}

/**
 * Upsert this runner process's registration against an already-resolved target,
 * recording its heartbeat and non-secret diagnostics.
 *
 * The target row is never touched. Several runner instances may serve one target
 * — a host runner plus every container adopting it — so identity is the runner
 * instance, not the target.
 */
export async function recordRunnerHeartbeat({
  ctx,
  executionTargetId,
  runnerInstanceId,
  relation,
  label,
  runnerVersion,
  capabilities,
  supportedAgents,
  health = 'healthy',
  lastErrorCode = null
}: {
  ctx: ServiceContext;
  executionTargetId: string;
  runnerInstanceId: string;
  relation: RunnerRelation;
  label?: string | null;
  runnerVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
  supportedAgents?: string[] | null;
  health?: string;
  lastErrorCode?: string | null;
}): Promise<RunnerRegistration> {
  const now = nowIso();
  const capabilitiesJson = JSON.stringify(capabilities ?? {});
  const supportedAgentsJson = JSON.stringify(supportedAgents ?? []);

  const existing = (await ctx.db.get(
    `SELECT id, revision, health, last_heartbeat_at FROM execution_target_runner_registrations
        WHERE workspace_id = ? AND runner_instance_id = ? AND deleted_at IS NULL`,
    [ctx.workspace.id, runnerInstanceId]
  )) as
    | { id: string; revision: number; health: string; last_heartbeat_at: string | null }
    | undefined;

  // A *reconnect*, not every heartbeat: a first registration, a return from an
  // unhealthy state, or a gap longer than the liveness TTL. Queue entries held
  // on `resource_disconnected` should clear as soon as the runner is back
  // rather than on the next 60 s sweep, but a healthy runner beating every few
  // seconds must not enqueue a dispatch job each time.
  const reconnected =
    !existing ||
    (existing.health !== health && health === 'healthy') ||
    isStaleHeartbeat(existing.last_heartbeat_at, now);

  if (existing) {
    await ctx.db.run(
      `UPDATE execution_target_runner_registrations
          SET execution_target_id = ?, relation = ?, label = ?, runner_version = ?,
              capabilities_json = ?, supported_agents_json = ?, health = ?,
              last_heartbeat_at = ?, last_error_code = ?, updated_at = ?,
              revision = revision + 1
        WHERE id = ?`,
      [
        executionTargetId,
        relation,
        trimmed(label),
        trimmed(runnerVersion),
        capabilitiesJson,
        supportedAgentsJson,
        health,
        now,
        lastErrorCode,
        now,
        existing.id
      ]
    );
    await recordChange({
      ctx,
      entityType: 'execution_target_runner_registration',
      entityId: existing.id,
      operation: 'update',
      entityRevision: existing.revision + 1,
      changedFields: ['health', 'last_heartbeat_at', 'relation', 'execution_target_id']
    });
    if (reconnected) await enqueueRunQueueDispatchForWorkspace(ctx.db, ctx.workspace.id);
    return {
      id: existing.id,
      executionTargetId,
      runnerInstanceId,
      relation,
      label: trimmed(label),
      runnerVersion: trimmed(runnerVersion),
      supportedAgents: supportedAgents ?? [],
      health,
      lastHeartbeatAt: now,
      lastErrorCode
    };
  }

  const id = newId();
  await ctx.db.run(
    `INSERT INTO execution_target_runner_registrations
        (id, workspace_id, execution_target_id, runner_instance_id, relation, label,
         runner_version, capabilities_json, supported_agents_json, health,
         last_heartbeat_at, last_error_code, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      ctx.workspace.id,
      executionTargetId,
      runnerInstanceId,
      relation,
      trimmed(label),
      trimmed(runnerVersion),
      capabilitiesJson,
      supportedAgentsJson,
      health,
      now,
      lastErrorCode,
      now,
      now
    ]
  );
  await recordChange({
    ctx,
    entityType: 'execution_target_runner_registration',
    entityId: id,
    operation: 'insert',
    entityRevision: 1
  });
  if (reconnected) await enqueueRunQueueDispatchForWorkspace(ctx.db, ctx.workspace.id);
  return {
    id,
    executionTargetId,
    runnerInstanceId,
    relation,
    label: trimmed(label),
    runnerVersion: trimmed(runnerVersion),
    supportedAgents: supportedAgents ?? [],
    health,
    lastHeartbeatAt: now,
    lastErrorCode
  };
}

export type TargetRunnerLiveness = {
  /** Any non-deleted runner has ever registered for this target. */
  hasRegistration: boolean;
  /** A registration is healthy/degraded with a heartbeat inside the TTL. */
  live: boolean;
  /** Most recent heartbeat across this target's runners, live or not. */
  lastHeartbeatAt: string | null;
  nativeCount: number;
  adoptedCount: number;
};

export async function listRunnerRegistrations({
  ctx,
  executionTargetIds
}: {
  ctx: ServiceContext;
  executionTargetIds: string[];
}): Promise<Map<string, RunnerRegistration[]>> {
  const result = new Map<string, RunnerRegistration[]>();
  const ids = [...new Set(executionTargetIds.filter(Boolean))];
  if (!ids.length) return result;
  const rows = (await ctx.db.all(
    `SELECT id, execution_target_id, runner_instance_id, relation, label, runner_version,
            supported_agents_json, health, last_heartbeat_at, last_error_code
       FROM execution_target_runner_registrations
      WHERE workspace_id = ? AND deleted_at IS NULL AND execution_target_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY last_heartbeat_at DESC, created_at ASC`,
    [ctx.workspace.id, ...ids]
  )) as Array<{
    id: string;
    execution_target_id: string;
    runner_instance_id: string;
    relation: RunnerRelation;
    label: string | null;
    runner_version: string | null;
    supported_agents_json: string;
    health: string;
    last_heartbeat_at: string | null;
    last_error_code: string | null;
  }>;
  for (const row of rows) {
    let supportedAgents: string[] = [];
    try {
      const parsed = JSON.parse(row.supported_agents_json) as unknown;
      supportedAgents = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      /* absent */
    }
    const registrations = result.get(row.execution_target_id) ?? [];
    registrations.push({
      id: row.id,
      executionTargetId: row.execution_target_id,
      runnerInstanceId: row.runner_instance_id,
      relation: row.relation,
      label: row.label,
      runnerVersion: row.runner_version,
      supportedAgents,
      health: row.health,
      lastHeartbeatAt: row.last_heartbeat_at,
      lastErrorCode: row.last_error_code
    });
    result.set(row.execution_target_id, registrations);
  }
  return result;
}

function emptyLiveness(): TargetRunnerLiveness {
  return {
    hasRegistration: false,
    live: false,
    lastHeartbeatAt: null,
    nativeCount: 0,
    adoptedCount: 0
  };
}

/**
 * Runner liveness for a set of local targets, in one query.
 *
 * `hasRegistration` is what makes the rollout compatible: a target that has
 * never had a runner registration keeps its legacy `devices.last_seen_at`
 * reachability, and stops honoring it the moment its upgraded runner publishes
 * a first heartbeat (contract v40).
 */
export async function readRunnerLiveness({
  ctx,
  executionTargetIds,
  now = Date.now()
}: {
  ctx: ServiceContext;
  executionTargetIds: string[];
  now?: number;
}): Promise<Map<string, TargetRunnerLiveness>> {
  const liveness = new Map<string, TargetRunnerLiveness>();
  const unique = [...new Set(executionTargetIds.filter(id => id))];
  if (unique.length === 0) return liveness;

  const placeholders = unique.map(() => '?').join(', ');
  const rows = (await ctx.db.all(
    `SELECT execution_target_id, relation, health, last_heartbeat_at
       FROM execution_target_runner_registrations
      WHERE workspace_id = ? AND deleted_at IS NULL
        AND execution_target_id IN (${placeholders})`,
    [ctx.workspace.id, ...unique]
  )) as Array<{
    execution_target_id: string;
    relation: string;
    health: string;
    last_heartbeat_at: string | null;
  }>;

  for (const row of rows) {
    const entry = liveness.get(row.execution_target_id) ?? emptyLiveness();
    entry.hasRegistration = true;
    if (row.relation === 'adopted') entry.adoptedCount += 1;
    else entry.nativeCount += 1;

    const heartbeat = row.last_heartbeat_at;
    if (heartbeat && (!entry.lastHeartbeatAt || heartbeat > entry.lastHeartbeatAt)) {
      entry.lastHeartbeatAt = heartbeat;
    }
    const healthy = (LIVE_RUNNER_HEALTH as readonly string[]).includes(row.health);
    const recent =
      heartbeat !== null && now - new Date(heartbeat).getTime() < RUNNER_HEARTBEAT_STALE_MS;
    if (healthy && recent) entry.live = true;

    liveness.set(row.execution_target_id, entry);
  }
  return liveness;
}
