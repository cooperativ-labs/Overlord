import { missionDisplayIdFromObjectiveRef, type ProtocolRequestBody } from '@overlord/contract';

import { hashSessionKey } from '../../packages/core/service/util.ts';
import { projectInTokenScope, serviceDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';

import { ProjectSelectionRequiredError, resolveProjectRefChoices } from './project-refs.ts';

export type ProtocolAddress = {
  executionRequestId: string | null;
  sessionKey: string | null;
  objectiveRef: string | null;
  missionRef: string | null;
  projectRef: string | null;
  workspaceHint: string | null;
};

/** Read the address consistently for workspace routing and handlers. */
export function readProtocolAddress(body: ProtocolRequestBody): ProtocolAddress {
  const read = (flag: string): string | null => {
    const value = body.flags?.[flag];
    return typeof value === 'string' ? value.trim() || null : null;
  };

  const objectiveRef = read('--objective-id');
  return {
    executionRequestId: read('--execution-request-id'),
    sessionKey: read('--session-key'),
    objectiveRef,
    missionRef: read('--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef),
    projectRef: read('--project-id'),
    workspaceHint: read('--workspace-id')
  };
}

/**
 * Resolve `agent_sessions.id` from `--session-key` when present. Soft lookup —
 * a missing or unknown key yields null rather than failing the create path.
 */
export async function resolveSessionId(sessionKey: string | null): Promise<string | null> {
  if (!sessionKey) return null;
  const session = await serviceDatabaseClient().get<{ id: string }>(
    `SELECT id FROM agent_sessions
      WHERE session_key_hash = ? AND deleted_at IS NULL`,
    [hashSessionKey(sessionKey)]
  );
  return session?.id ?? null;
}

export async function deriveProtocolWorkspaceId(
  address: ProtocolAddress,
  workspaceIds: string[]
): Promise<string | null> {
  if (workspaceIds.length === 0) return null;
  const { executionRequestId, sessionKey, objectiveRef, missionRef, projectRef, workspaceHint } =
    address;
  const placeholders = workspaceIds.map(() => '?').join(', ');
  const db = serviceDatabaseClient();

  if (executionRequestId) {
    const request = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM execution_requests
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [executionRequestId, ...workspaceIds]
    );
    if (request) return request.workspace_id;
  }

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
  // display id falls through to the mission lookup below.
  if (objectiveRef) {
    const objective = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM objectives
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [objectiveRef, ...workspaceIds]
    );
    if (objective) return objective.workspace_id;
  }

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
  if (!projectRef) return null;
  const choices = await resolveProjectRefChoices({
    projectRef,
    workspaceHint,
    workspaceIds
  });
  if (choices.length > 1) throw new ProjectSelectionRequiredError(projectRef, choices);
  return choices[0]?.workspaceId ?? null;
}
