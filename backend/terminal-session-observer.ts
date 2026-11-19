/** Observe terminals even after their objectives deliver. No terminal output is retained. */
import { parseMetadataJson } from '../packages/core/service/execution-requests.ts';
import { providerSessionFromMetadata } from '../packages/core/service/latch-launch.ts';
import { forgetLatchProviderSession } from '../packages/core/service/latch-provider-session.ts';
import { resolveDefaultLocalTargetProvider } from '../packages/core/service/local-target/default-registry.ts';
import { listEligibleProjectExecutionTargets } from '../packages/core/service/project-execution-target.ts';
import { launchSessionSnapshotFromMetadata } from '../packages/core/service/terminal-profile-types.ts';
import {
  recordTerminalObservation,
  terminalMetadataSql
} from '../packages/core/service/terminal-session-lifecycle.ts';

import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from './db.ts';
import { PollLoop } from './poll-loop.ts';

export class TerminalSessionObserver extends PollLoop {
  constructor() {
    super({ intervalMs: 30_000, logPrefix: 'terminal-sessions', runOnStart: true });
  }

  async runOnce(): Promise<void> {
    const db = requireDatabaseClient();
    const field = (name: string) => terminalMetadataSql(db.dialect, name);
    // Oldest observation first gives all non-ended terminals a turn. Bounded
    // batches and timeouts prevent dead machines from monopolizing the worker.
    const rows = await db.all<{
      id: string;
      requested_by_workspace_user_id: string | null;
      claiming_target_owner_id: string | null;
      claimed_by_execution_target_id: string | null;
      workspace_id: string;
      project_id: string;
      mission_id: string;
      metadata_json: string;
      target_id: string | null;
    }>(`SELECT er.id, COALESCE(er.claimed_by_execution_target_id, er.execution_target_id) AS target_id,
        er.requested_by_workspace_user_id, er.claimed_by_execution_target_id,
        owner.id AS claiming_target_owner_id, er.workspace_id, er.project_id, er.mission_id, er.metadata_json
      FROM execution_requests er JOIN missions m ON m.id = er.mission_id AND m.deleted_at IS NULL
      JOIN projects p ON p.id = er.project_id AND p.deleted_at IS NULL
      JOIN workspaces w ON w.id = er.workspace_id AND w.deleted_at IS NULL
      LEFT JOIN execution_targets et ON er.requested_by_workspace_user_id IS NULL
        AND et.id = er.claimed_by_execution_target_id AND et.workspace_id = er.workspace_id
        AND et.type = 'local' AND et.status = 'active' AND et.deleted_at IS NULL
      LEFT JOIN workspace_users owner ON owner.id = et.owner_workspace_user_id
        AND owner.workspace_id = er.workspace_id AND owner.status = 'active' AND owner.deleted_at IS NULL
      WHERE er.deleted_at IS NULL AND ${field('provider')} = 'latch'
        AND COALESCE(${field('lastObservedState')}, 'running') <> 'exited'
      ORDER BY COALESCE(${field('lastObservedAt')}, CAST(er.created_at AS TEXT)), er.id LIMIT 20`);
    const results = await Promise.allSettled(
      rows.map(async row => {
        const mapping = providerSessionFromMetadata(parseMetadataJson(row.metadata_json));
        if (!mapping) return;
        const ctx = {
          ...(await buildWebappServiceContextForWorkspace(
            row.workspace_id,
            db,
            row.requested_by_workspace_user_id
          )),
          source: 'runner' as const
        };
        const targetId = mapping.executionTargetId ?? row.target_id;
        // Automated launches can have no requester. Check the claiming target's
        // owner for eligibility, but keep the probe and observation system-attributed.
        const eligibilityMember =
          row.requested_by_workspace_user_id ??
          (targetId === row.claimed_by_execution_target_id ? row.claiming_target_owner_id : null);
        const eligibleTargets = eligibilityMember
          ? await listEligibleProjectExecutionTargets({
              ctx: { ...ctx, actorWorkspaceUserId: eligibilityMember },
              projectId: row.project_id
            })
          : [];
        const target = eligibleTargets.find(t => t.executionTargetId === targetId);
        let state: 'running' | 'stopping' | 'lost' | 'exited' = 'lost';
        let endedAt: string | null = null;
        if (target?.reachable) {
          const provider = resolveDefaultLocalTargetProvider({
            target: {
              executionTargetId: target.executionTargetId,
              type: target.type,
              reachable: true
            },
            options: {
              callerExecutionTargetId: null,
              runnerQueue: {
                ctx,
                projectId: row.project_id,
                missionId: row.mission_id,
                readTimeoutMs: 10_000,
                // Replicas in the same sweep share the read-only inspection job.
                operationId: `terminal-observe:${row.id}:${Math.floor(Date.now() / 30_000)}`
              }
            }
          });
          const snapshot = launchSessionSnapshotFromMetadata(parseMetadataJson(row.metadata_json));
          const result = await provider.inspectLatchSession({
            providerSessionId: mapping.providerSessionId,
            executable: snapshot?.executionProvider.executable ?? 'latch'
          });
          if (!result.ok && result.code === 'LATCH_SESSION_ABSENT') {
            await forgetLatchProviderSession({
              ctx,
              missionId: row.mission_id,
              executionRequestId: row.id,
              providerSessionId: mapping.providerSessionId
            });
            return;
          }
          if (result.ok) {
            state = result.value.state;
            endedAt = result.value.endedAt ?? null;
          }
        }
        await recordTerminalObservation({
          ctx,
          executionRequestId: row.id,
          providerSessionId: mapping.providerSessionId,
          state,
          endedAt
        });
      })
    );
    for (const result of results)
      if (result.status === 'rejected') {
        // A concurrent end/forget may change the mapping; retry it on a later sweep.
        console.warn('[terminal-sessions] observation failed', result.reason);
      }
  }
}
export const terminalSessionObserver = new TerminalSessionObserver();
