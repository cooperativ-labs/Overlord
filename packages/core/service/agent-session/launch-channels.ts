import type { ServiceContext } from '../context.js';
import { ServiceError } from '../errors.js';

import { type AgentSessionChannelBootstrap, createSessionChannel } from './channels.js';

/**
 * Launch-time channels for control-plane harnesses (ADR 0092, amending ADR 0065 decision 1).
 *
 * A control-plane adapter (the Codex app-server supervisor) is not a hook inside the agent: it is
 * the process that drives the agent, and it must post events and open approval cards from the
 * first turn, before the agent has attached. It therefore needs a channel credential at launch.
 * Every other launch still mints none; protocol attach remains the binding declaration, and it
 * binds this channel by objective when it runs.
 *
 * The set of adapters is closed on purpose. A channel credential is an authority, and minting one
 * for an adapter whose runtime does not exist would hand out a credential nothing uses, which is
 * the definition of a credential that leaks.
 */

export const CONTROL_PLANE_LAUNCH_KIND = 'control_plane';

/** Adapter key → agent identifier, for the control-plane adapters launch may mint channels for. */
export const CONTROL_PLANE_LAUNCH_ADAPTERS: Readonly<Record<string, string>> = Object.freeze({
  'codex-app-server': 'codex'
});

/** Objective states a launch channel may be minted for. Matches what a runner can launch. */
const MINTABLE_OBJECTIVE_STATES = new Set([
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery'
]);

export type ControlPlaneLaunchChannel = AgentSessionChannelBootstrap & {
  adapterKey: string;
  agentIdentifier: string;
};

export async function mintControlPlaneLaunchChannel({
  ctx,
  objectiveId,
  adapterKey,
  adapterVersion = null,
  executionRequestId = null,
  executionTargetId = null
}: {
  ctx: ServiceContext;
  objectiveId: string;
  adapterKey: string;
  adapterVersion?: string | null;
  executionRequestId?: string | null;
  executionTargetId?: string | null;
}): Promise<ControlPlaneLaunchChannel> {
  const key = adapterKey.trim();
  const agentIdentifier = CONTROL_PLANE_LAUNCH_ADAPTERS[key];
  if (!agentIdentifier) {
    throw new ServiceError(
      `Adapter "${key}" does not take a launch channel`,
      'adapter_not_control_plane',
      400
    );
  }

  const objective = await ctx.db.get<{
    id: string;
    mission_id: string;
    project_id: string | null;
    state: string;
  }>(
    `SELECT id, mission_id, project_id, state FROM objectives
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [objectiveId, ctx.workspace.id]
  );
  if (!objective) throw new ServiceError('Objective not found', 'objective_not_found', 404);
  if (!MINTABLE_OBJECTIVE_STATES.has(objective.state)) {
    throw new ServiceError(
      `Objective is not launchable from state "${objective.state}"`,
      'objective_not_launchable',
      409
    );
  }

  let requestId: string | null = null;
  if (executionRequestId?.trim()) {
    const request = await ctx.db.get<{ id: string }>(
      `SELECT id FROM execution_requests
        WHERE id = ? AND workspace_id = ? AND objective_id = ?`,
      [executionRequestId.trim(), ctx.workspace.id, objective.id]
    );
    // An execution request that is not this objective's would correlate the channel with
    // someone else's launch; refuse rather than drop it silently.
    if (!request) {
      throw new ServiceError('Execution request not found', 'execution_request_not_found', 404);
    }
    requestId = request.id;
  }

  let targetId: string | null = null;
  if (executionTargetId?.trim()) {
    const target = await ctx.db.get<{ id: string }>(
      `SELECT id FROM execution_targets WHERE id = ? AND workspace_id = ?`,
      [executionTargetId.trim(), ctx.workspace.id]
    );
    targetId = target?.id ?? null;
  }

  const { bootstrap } = await createSessionChannel({
    ctx,
    missionId: objective.mission_id,
    objectiveId: objective.id,
    projectId: objective.project_id,
    executionRequestId: requestId,
    executionTargetId: targetId,
    agentIdentifier,
    adapterKey: key,
    adapterVersion: adapterVersion?.trim() || null,
    launchKind: CONTROL_PLANE_LAUNCH_KIND
  });
  return { ...bootstrap, adapterKey: key, agentIdentifier };
}

export type ChannelLifecycle = {
  /** The bound objective's state, or `deleted` when it is gone; null when the channel has none. */
  objectiveState: string | null;
  /** The bound session's delivery state; null before attach binds one. */
  deliveryState: string | null;
};

/**
 * What a control-plane supervisor needs to know to stop on its own (ADR 0092): whether its
 * objective ended, and whether its session delivered. Read on every heartbeat; it reveals nothing
 * beyond the channel's own objective and session.
 */
export async function readChannelLifecycle({
  ctx,
  channel
}: {
  ctx: ServiceContext;
  channel: { objective_id: string | null; session_id: string | null };
}): Promise<ChannelLifecycle> {
  let objectiveState: string | null = null;
  if (channel.objective_id) {
    const objective = await ctx.db.get<{ state: string; deleted_at: string | null }>(
      `SELECT state, deleted_at FROM objectives WHERE id = ? AND workspace_id = ?`,
      [channel.objective_id, ctx.workspace.id]
    );
    objectiveState = !objective || objective.deleted_at !== null ? 'deleted' : objective.state;
  }
  let deliveryState: string | null = null;
  if (channel.session_id) {
    const session = await ctx.db.get<{ delivery_state: string | null }>(
      `SELECT delivery_state FROM agent_sessions WHERE id = ? AND workspace_id = ?`,
      [channel.session_id, ctx.workspace.id]
    );
    deliveryState = session?.delivery_state ?? null;
  }
  return { objectiveState, deliveryState };
}
