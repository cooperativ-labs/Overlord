import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  claimNextExecutionRequest,
  listExecutionRequests,
  markExecutionLaunching
} from '../packages/core/service/execution-requests.ts';
import { resolveRunnerTarget } from '../packages/core/service/execution-target-runners.ts';
import {
  completeLocalTargetMutationRequest,
  createLocalTargetMutationRequest,
  waitForLocalTargetMutationResult
} from '../packages/core/service/local-target-mutations.ts';
import { addProjectResource, createProject } from '../packages/core/service/projects.ts';
import { protocolCreate } from '../packages/core/service/protocol.ts';
import { inspectTerminalInBackground } from '../packages/core/service/terminal-observation-probes.ts';
import {
  pruneLegacyTerminalProbes,
  pruneTerminalProbes
} from '../packages/core/service/terminal-probe-policy.ts';
import { recordTerminalObservation } from '../packages/core/service/terminal-session-lifecycle.ts';
import {
  createIsolatedCheckout,
  createSeededServiceContext
} from '../packages/core/service/test-helpers.ts';

import { conformanceAdapters, createConformanceDatabase } from './test-helpers.ts';

for (const adapter of conformanceAdapters()) {
  test(`scoped Latch probe reuse, runner retry and cleanup on ${adapter}`, async t => {
    const database = await createConformanceDatabase(adapter, 'terminal_probes');
    const { db } = database;
    try {
      const { ctx, workspaceUserId } = await createSeededServiceContext({ db, source: 'cli' });
      ctx.clientDevice = {
        deviceFingerprint: 'test-terminal-observer-probe-device',
        deviceLabel: 'Terminal observer probe device',
        devicePlatform: 'darwin'
      };
      const project = await createProject({ ctx, name: 'Probe lifecycle' });
      await addProjectResource({
        ctx,
        projectId: project.id,
        directoryPath: createIsolatedCheckout('ovld-background-probe-'),
        isPrimary: true
      });
      const { mission, objectives } = await protocolCreate({
        ctx,
        projectId: project.id,
        objectives: [{ instructions: 'Observe launch' }]
      });
      const { executionTargetId } = await resolveRunnerTarget({ ctx, input: {} });
      const mappingId = randomUUID();
      const providerSessionId = 'ses_observed';
      const createdAt = new Date(Date.now() - 60_000).toISOString();
      await db.run(
        `INSERT INTO execution_requests
         (id, workspace_id, project_id, mission_id, objective_id, execution_target_id,
          requested_by_workspace_user_id, requested_source, status, launch_mode, metadata_json,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_run', 'launched', 'run', ?, ?, ?)`,
        [
          mappingId,
          ctx.workspace.id,
          project.id,
          mission.id,
          objectives[0]!.id,
          executionTargetId,
          ctx.actorWorkspaceUserId,
          JSON.stringify({
            providerSession: {
              provider: 'latch',
              providerSessionId,
              executionTargetId,
              createdAt,
              lastObservedState: 'running'
            }
          }),
          createdAt,
          createdAt
        ]
      );
      const options = {
        ctx,
        projectId: project.id,
        missionId: mission.id,
        mappingId,
        providerSessionId,
        executionTargetId,
        eligibilityMember: workspaceUserId
      };
      const assertInvisible = async (requestId: string) => {
        assert.equal(
          await db.get('SELECT seq FROM entity_changes WHERE entity_id = ?', [requestId]),
          undefined
        );
        assert.ok(
          !(await listExecutionRequests({ ctx, includeInactive: true })).some(
            item => item.id === requestId
          )
        );
      };
      const finishProbe = async (
        claim: NonNullable<Awaited<ReturnType<typeof claimNextExecutionRequest>>>
      ) => {
        const requestId = claim.id;
        await markExecutionLaunching({ ctx, requestId });
        const result = {
          ok: true as const,
          target: { executionTargetId, deviceLabel: null, transport: 'runner_queue' as const },
          value: { providerSessionId, state: 'running' }
        };
        await completeLocalTargetMutationRequest({ ctx, requestId, result });
        return result;
      };
      const claimProbe = async () => {
        for (let attempt = 0; attempt < 120; attempt++) {
          const claim = await claimNextExecutionRequest({ ctx, projectId: project.id });
          if (claim) return claim;
          await delay(10);
        }
        assert.fail('No inspection could be claimed');
      };

      // Two freshly constructed callers race. A third can reuse their result
      // using the database alone, with no process-local cache.
      const measuredAt = performance.now();
      const first = inspectTerminalInBackground(options);
      const second = inspectTerminalInBackground({ ...options, ctx: { ...ctx } });
      const claim = await claimProbe();
      assert.equal(claim.missionId, null);
      assert.equal(claim.objectiveId, null);
      assert.equal(await pruneTerminalProbes(db), 0);
      const result = await finishProbe(claim);
      const both = await Promise.all([first, second]);
      const sharedLatencyMs = Math.round(performance.now() - measuredAt);
      assert.deepEqual(
        both.map(row => row?.id),
        [claim.id, claim.id]
      );
      assert.equal(both.filter(row => row?.reused).length, 1);
      const cached = await inspectTerminalInBackground({ ...options, ctx: { ...ctx } });
      assert.equal(cached?.id, claim.id);
      assert.equal(cached?.reused, true);
      assert.equal(cached?.result.ok, true);
      const retry = await completeLocalTargetMutationRequest({
        ctx,
        requestId: claim.id,
        result: { ...result, value: { ...result.value, state: 'lost' } }
      });
      assert.deepEqual(retry?.result, { ok: true, value: result.value });
      await assertInvisible(claim.id);

      assert.equal(
        await inspectTerminalInBackground({
          ...options,
          ctx: { ...ctx, actorWorkspaceUserId: null }
        }),
        null
      );
      assert.equal(
        await inspectTerminalInBackground({ ...options, executionTargetId: randomUUID() }),
        null
      );
      await assert.rejects(() =>
        inspectTerminalInBackground({
          ...options,
          ctx: { ...ctx, allowedProjectIds: [] }
        })
      );

      // Age the result beyond the reuse window and admit a new job. An
      // unrelated explicit inspection still emits its full queue history.
      const old = new Date(Date.now() - 20_000).toISOString();
      await db.run('UPDATE execution_requests SET created_at = ? WHERE id = ?', [old, claim.id]);
      const next = inspectTerminalInBackground(options);
      const nextClaim = await claimProbe();
      assert.notEqual(nextClaim.id, claim.id);
      await finishProbe(nextClaim);
      assert.equal((await next)?.reused, false);
      await assertInvisible(nextClaim.id);
      const explicit = await createLocalTargetMutationRequest({
        ctx,
        projectId: project.id,
        missionId: mission.id,
        executionTargetId,
        kind: 'capability_call',
        capability: 'inspectLatchSession',
        input: { providerSessionId }
      });
      const explicitClaim = await claimProbe();
      assert.equal(explicitClaim.id, explicit.id);
      await finishProbe(explicitClaim);
      const feed = await db.get<{ count: number }>(
        'SELECT count(*) AS count FROM entity_changes WHERE entity_id = ?',
        [explicit.id]
      );
      assert.equal(Number(feed?.count), 4);

      // Retention is based on completion time, and does not touch the
      // launch mapping or explicit operation.
      const afterGrace = Date.now() + 16 * 60_000;
      assert.equal(await pruneTerminalProbes(db, afterGrace), 2);
      assert.equal(await pruneTerminalProbes(db, afterGrace), 0);
      assert.ok(await db.get('SELECT id FROM execution_requests WHERE id = ?', [explicit.id]));
      const endedAt = new Date().toISOString();
      assert.equal(
        await recordTerminalObservation({
          ctx,
          executionRequestId: mappingId,
          providerSessionId,
          state: 'exited',
          endedAt
        }),
        'exited'
      );
      assert.equal(
        await recordTerminalObservation({
          ctx,
          executionRequestId: mappingId,
          providerSessionId,
          state: 'lost',
          backgroundObservation: { executionTargetId, startedAt: old }
        }),
        'exited'
      );

      if (db.dialect === 'postgres') {
        // Recreate two concurrent observer calls on opposite sides of the old
        // fixed bucket. The runner handles them serially, as it does today.
        const legacyStartedAt = performance.now();
        const legacyOptions = {
          ctx,
          projectId: project.id,
          missionId: mission.id,
          executionTargetId,
          kind: 'capability_call' as const,
          capability: 'inspectLatchSession' as const,
          input: { providerSessionId }
        };
        const legacy = await createLocalTargetMutationRequest({
          ...legacyOptions,
          operationId: `terminal-observe:${mappingId}:100`
        });
        const adjacent = await createLocalTargetMutationRequest({
          ...legacyOptions,
          operationId: `terminal-observe:${mappingId}:101`
        });
        const waits = [legacy, adjacent].map(job =>
          waitForLocalTargetMutationResult({
            ctx,
            requestId: job.id,
            target: result.target
          })
        );
        await finishProbe(await claimProbe());
        await finishProbe(await claimProbe());
        await Promise.all(waits);
        const legacyLatencyMs = Math.round(performance.now() - legacyStartedAt);
        const bytes = await db.get<{ feed_rows: string; retained_bytes: string }>(
          `SELECT (SELECT count(*) FROM entity_changes WHERE entity_id IN (?, ?)) AS feed_rows,
                  (SELECT sum(pg_column_size(er)) FROM execution_requests er WHERE id IN (?, ?)) +
                  (SELECT sum(pg_column_size(c)) FROM entity_changes c WHERE entity_id IN (?, ?))
                  AS retained_bytes`,
          [legacy.id, adjacent.id, legacy.id, adjacent.id, legacy.id, adjacent.id]
        );
        assert.equal(Number(bytes?.feed_rows), 8);
        t.diagnostic(
          `Adjacent observer deliveries, old vs scoped: 2 → 1 requests, 8 → 0 feed rows, ` +
            `${bytes?.retained_bytes} → 0 retained request/feed tuple bytes after 16 minutes, ` +
            `${legacyLatencyMs} → ${sharedLatencyMs} ms for both waiters to receive results`
        );
        const later = Date.now() + 22 * 24 * 60 * 60_000;
        assert.equal(await pruneLegacyTerminalProbes(db, later), 0);
        await db.run('DELETE FROM entity_changes WHERE entity_id = ?', [legacy.id]);
        assert.equal(await pruneLegacyTerminalProbes(db, later), 1);
        assert.equal(await pruneLegacyTerminalProbes(db, later), 0);
      }
    } finally {
      await database.cleanup();
    }
  });
}
