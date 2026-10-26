import { MISSION_SUMMARY_EVIDENCE_LIMIT } from '@overlord/contract';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildDeliveryReport } from '../packages/core/service/delivery-report.ts';
import {
  claimNextWorkerJob,
  completeMissionSummaryComposeJob,
  enqueueMissionSummaryComposeJob,
  MISSION_SUMMARY_COMPOSE_JOB_TYPE,
  publishMissionSummary
} from '../packages/core/service/worker-jobs.ts';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase,
  seedAuthenticatedOperatorClient
} from './test-helpers.ts';

for (const adapter of conformanceAdapters()) {
  describe(`mission summary contract [${adapter}]`, () => {
    it('upgrades historical missions and deferred work while preserving all other delivery evidence', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_upgrade');
      try {
        await bindWebappDatabaseClient({ client: db });
        const { createProject, createMission } = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const project = await createProject({ name: 'Upgrade summary' });
        const old = await createMission({ projectId: project.id, firstObjective: 'Historical' });
        const report = buildDeliveryReport({
          summary: 'Historical narrative.',
          deliveryReport: {
            schemaVersion: 1,
            agentReport: { knownRisks: ['Keep this risk'], assumptions: ['Keep this assumption'] }
          }
        });
        const payload = {
          other: 'preserved',
          deliveryReport: {
            ...report,
            agentReport: { ...report.agentReport, deferredWork: ['Retired suggestion'] },
            presentation: { ...report.presentation, deferredWork: ['Retired rewrite'] }
          }
        };
        const stamp = '2026-10-01T00:00:00.000Z';
        await db.run(
          `INSERT INTO deliveries (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json, delivered_at, created_at, updated_at)
          VALUES ('historical', ?, ?, ?, ?, 'Historical narrative.', ?, ?, ?, ?)`,
          [
            old.workspaceId,
            project.id,
            old.id,
            old.objectives[0]!.id,
            JSON.stringify(payload),
            stamp,
            stamp,
            stamp
          ]
        );
        await db.run(
          `INSERT INTO human_action_resolutions (delivery_id, action_id, workspace_id, mission_id, objective_id, status, resolved_at)
          VALUES ('historical', 'deferred-work-0-retired', ?, ?, ?, 'dismissed', ?)`,
          [old.workspaceId, old.id, old.objectives[0]!.id, stamp]
        );
        await db.exec(
          'DROP TABLE mission_summary_seen; DROP TABLE mission_summaries; ALTER TABLE missions DROP COLUMN summary_enabled;'
        );
        for (const file of [
          '20261024140000_mission_summaries.sql',
          '20261024140100_deferred_work_structured_cutover.sql'
        ]) {
          await db.exec(
            readFileSync(
              new URL(`../database/${adapter}/migrations/${file}`, import.meta.url),
              'utf8'
            )
          );
        }
        const oldRow = await db.get<{ summary_enabled: unknown }>(
          'SELECT summary_enabled FROM missions WHERE id = ?',
          [old.id]
        );
        assert.equal(Number(oldRow?.summary_enabled), 0);
        const fresh = await createMission({ projectId: project.id, firstObjective: 'Fresh' });
        const freshRow = await db.get<{ summary_enabled: unknown }>(
          'SELECT summary_enabled FROM missions WHERE id = ?',
          [fresh.id]
        );
        assert.equal(Number(freshRow?.summary_enabled), 1);
        const row = await db.get<{ payload_json: string }>(
          "SELECT payload_json FROM deliveries WHERE id = 'historical'"
        );
        assert.deepEqual(JSON.parse(row!.payload_json), {
          other: 'preserved',
          deliveryReport: report
        });
        assert.equal(
          Number(
            (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM human_action_resolutions'))?.n
          ),
          0
        );
        const search = await db.get<{ body_text: string }>(
          "SELECT body_text FROM search_documents WHERE entity_type = 'delivery' AND entity_id = 'historical'"
        );
        assert.match(search!.body_text, /Keep this risk/);
        assert.doesNotMatch(search!.body_text, /Retired/);
        const ctx = buildWebappServiceContext();
        assert.equal(
          (
            await db.transaction(tx =>
              enqueueMissionSummaryComposeJob({
                ctx: { ...ctx, db: tx },
                missionId: old.id,
                reason: 'delivery_presented'
              })
            )
          ).triggered,
          false
        );
      } finally {
        await cleanup();
      }
    });
    it('selects evidence before bounds, preserves suggestions, and isolates monotonic seen markers', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_test');
      try {
        await bindWebappDatabaseClient({ client: db });
        const { createProject, createMission, createObjective, updateObjective } =
          await import('./repository.ts');
        const { getMissionSummary, markMissionSummarySeen } = await import('./mission-summary.ts');
        const { readMissionSummaryEvidence } =
          await import('../packages/core/service/mission-summary-evidence.ts');
        const { buildWebappServiceContext, setActiveWorkspaceUser } = await import('./db.ts');
        const { resolveDeferredWork, reopenDeferredWork } =
          await import('./deferred-work-resolutions.ts');
        const project = await createProject({ name: 'Summary conformance' });
        const mission = await createMission({
          projectId: project.id,
          firstObjective: 'Quiet objective'
        });
        const quiet = mission.objectives[0]!;
        const busy = await createObjective({
          missionId: mission.id,
          instructionText: 'Busy objective'
        });
        const deferred = {
          title: 'Add export telemetry',
          change: 'Measure export duration.',
          location: 'export.ts',
          doneWhen: 'The duration is recorded.'
        };
        const report = buildDeliveryReport({
          summary: 'Export works.',
          deliveryReport: {
            schemaVersion: 1,
            agentReport: {
              humanActions: [{ action: 'Enable export in production.', category: 'other' }],
              deferredWork: [deferred]
            }
          }
        });
        const quietDelivery = randomUUID();
        const insert = async (
          id: string,
          objectiveId: string,
          timestamp: string,
          payload = report
        ) => {
          await db.run(
            `INSERT INTO deliveries (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json, delivered_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'Export works.', ?, ?, ?, ?)`,
            [
              id,
              mission.workspaceId,
              project.id,
              mission.id,
              objectiveId,
              JSON.stringify({ deliveryReport: payload }),
              timestamp,
              timestamp,
              timestamp
            ]
          );
        };
        await insert(quietDelivery, quiet.id, '2026-10-01T00:00:00.000Z');
        await db.transaction(async () => {
          for (let i = 0; i < 205; i++) {
            await insert(randomUUID(), busy.id, new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString());
          }
        });
        const envelope = await getMissionSummary(mission.id);
        assert.equal(envelope.eligible, true);
        assert.equal(envelope.evidence?.totals.currentRunDeliveries, 206);
        assert.equal(envelope.evidence?.sources.length, 2);
        assert.ok(envelope.evidence?.actions.some(action => action.deliveryId === quietDelivery));
        const ctx = buildWebappServiceContext();
        await db.transaction(tx =>
          enqueueMissionSummaryComposeJob({
            ctx: { ...ctx, db: tx },
            missionId: mission.id,
            reason: 'delivery_presented'
          })
        );
        const evidence = await readMissionSummaryEvidence(db, mission.id);
        assert.equal(evidence?.runs.currentRun.length, 206);
        assert.ok(evidence?.runs.currentRun.some(delivery => delivery.id === quietDelivery));
        // Supersede the old delivery in sources; its suggestion still belongs
        // to this run, despite also being outside the newest 200 deliveries.
        await insert(
          randomUUID(),
          quiet.id,
          '2026-10-01T01:00:00.000Z',
          buildDeliveryReport({ summary: 'Export still works.', deliveryReport: undefined })
        );
        const ref = {
          deliveryId: quietDelivery,
          objectiveId: quiet.id,
          actionId: report.agentReport.deferredWork[0]!.id
        };
        const publication = {
          status: 'fallback' as const,
          headline: 'Export works.',
          summary: 'Export works.',
          risks: [],
          suggestions: [ref],
          sourceDeliveryId: null,
          generatedBy: 'deterministic' as const,
          model: null
        };
        await publishMissionSummary({ db, missionId: mission.id, generation: 1, publication });
        const projected = await getMissionSummary(mission.id);
        assert.equal(projected.summary?.suggestions[0]?.state, 'open');
        assert.equal(projected.summary?.suggestions[0]?.deliveredAt, '2026-10-01T00:00:00.000Z');
        assert.ok(!projected.evidence?.sources.some(source => source.deliveryId === quietDelivery));
        await resolveDeferredWork(quietDelivery, ref.actionId, {
          status: 'done',
          outcome: 'objective_added',
          outcomeRef: 'test:1.abcd'
        });
        const resolved = (await getMissionSummary(mission.id)).summary!.suggestions[0]!;
        assert.equal(resolved.state, 'resolved');
        assert.equal(resolved.deliveredAt, '2026-10-01T00:00:00.000Z');
        assert.equal('change' in resolved, false);
        assert.equal(resolved.resolution?.outcomeRef, 'test:1.abcd');
        await publishMissionSummary({ db, missionId: mission.id, generation: 2, publication });
        assert.equal(
          (await getMissionSummary(mission.id)).summary?.suggestions[0]?.state,
          'resolved'
        );
        await reopenDeferredWork(quietDelivery, ref.actionId);
        await resolveDeferredWork(quietDelivery, ref.actionId, { status: 'dismissed' });
        assert.deepEqual((await getMissionSummary(mission.id)).summary?.suggestions, []);

        const displayed = envelope.watermark!;
        await markMissionSummarySeen(mission.id, { watermark: displayed });
        await insert(randomUUID(), busy.id, '2026-10-03T00:00:00.000Z');
        await Promise.all([
          markMissionSummarySeen(mission.id, { watermark: '2026-10-01T00:00:00.000Z' }),
          markMissionSummarySeen(mission.id, { watermark: displayed })
        ]);
        assert.equal(
          (await getMissionSummary(mission.id)).seenAt,
          displayed,
          'old snapshots do not acknowledge a newer delivery'
        );
        await assert.rejects(
          markMissionSummarySeen(mission.id, { watermark: '2099-01-01T00:00:00.000Z' })
        );
        await seedAuthenticatedOperatorClient({
          client: db,
          profileId: 'reader-two',
          workspaceUserId: 'reader-two-member'
        });
        setActiveWorkspaceUser('reader-two-member');
        assert.equal((await getMissionSummary(mission.id)).seenAt, null);
        setActiveWorkspaceUser('operator-workspace-user');

        // The bound is applied after choosing each objective's current delivery.
        await db.transaction(async () => {
          for (let i = 0; i < 201; i++) {
            const objectiveId = randomUUID();
            const stamp = '2026-10-04T00:00:00.000Z';
            await db.run(
              `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position, state, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'complete', ?, ?)`,
              [
                objectiveId,
                mission.workspaceId,
                project.id,
                mission.id,
                `x${i}`,
                i + 2,
                stamp,
                stamp
              ]
            );
            await insert(randomUUID(), objectiveId, stamp);
          }
        });
        const bounded = (await getMissionSummary(mission.id)).evidence!;
        assert.equal(bounded.totals.sources, 203);
        assert.equal(bounded.sources.length, MISSION_SUMMARY_EVIDENCE_LIMIT);
        assert.deepEqual(bounded.truncated, { actions: true, sources: true });

        await updateObjective(quiet.id, { state: 'complete' });
        await updateObjective(quiet.id, { state: 'draft' });
        assert.ok(
          !(await getMissionSummary(mission.id)).evidence?.sources.some(
            source => source.objectiveId === quiet.id
          )
        );
      } finally {
        await cleanup();
      }
    });

    it('orders latest-per-objective by delivered_at then id and keeps reopen-boundary deliveries', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_ties');
      try {
        await bindWebappDatabaseClient({ client: db });
        const { createProject, createMission, createObjective } = await import('./repository.ts');
        const { getMissionSummary } = await import('./mission-summary.ts');
        const project = await createProject({ name: 'Summary ties' });
        const mission = await createMission({ projectId: project.id, firstObjective: 'Tied' });
        const tied = mission.objectives[0]!;
        const reopened = await createObjective({
          missionId: mission.id,
          instructionText: 'Reopened'
        });
        const insert = async (id: string, objectiveId: string, timestamp: string) => {
          await db.run(
            `INSERT INTO deliveries (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json, delivered_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'Done.', ?, ?, ?, ?)`,
            [
              id,
              mission.workspaceId,
              project.id,
              mission.id,
              objectiveId,
              JSON.stringify({}),
              timestamp,
              timestamp,
              timestamp
            ]
          );
        };
        const tie = '2026-10-05T00:00:00.000Z';
        await insert('tie-a', tied.id, tie);
        await insert('tie-c', tied.id, tie);
        await insert('tie-b', tied.id, tie);
        const boundary = '2026-10-05T00:00:00.000Z';
        await db.run('UPDATE objectives SET reopened_at = ? WHERE id = ?', [boundary, reopened.id]);
        await insert('before-reopen', reopened.id, '2026-10-04T23:59:59.999Z');
        await insert('at-reopen', reopened.id, boundary);

        const evidence = (await getMissionSummary(mission.id)).evidence!;
        assert.deepEqual(
          evidence.sources.map(source => source.deliveryId),
          ['tie-c', 'at-reopen'],
          'ties break on id descending, within and across objectives'
        );
        assert.equal(evidence.totals.currentRunDeliveries, 4);
      } finally {
        await cleanup();
      }
    });

    it('enables every creation path and recomposes on question/choice lifecycle transitions only', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_triggers');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { protocolCreate, protocolPrompt, recordWork } =
          await import('../packages/core/service/protocol.ts');
        const { createSessionChannel, endChannel } =
          await import('../packages/core/service/agent-session/channels.ts');
        const {
          createRequest,
          resolveRequest,
          cancelRequest,
          releaseRequestToTerminal,
          releaseExpiredRequests
        } = await import('../packages/core/service/agent-session/requests.ts');
        const project = await repo.createProject({ name: 'Creation paths' });
        const ctx = buildWebappServiceContext();
        const rest = await repo.createMission({ projectId: project.id, firstObjective: 'REST' });
        const created = await protocolCreate({
          ctx,
          projectId: project.id,
          objectives: [{ objective: 'Protocol create' }]
        });
        const prompted = await protocolPrompt({
          ctx,
          projectId: project.id,
          objectives: [{ objective: 'Protocol prompt' }],
          agentIdentifier: 'codex'
        });
        const recorded = await recordWork({
          ctx,
          projectId: project.id,
          objective: 'Recorded work',
          summary: 'Done.'
        });
        const inbox = await repo.createInboxItem({ title: 'Inbox', objectives: ['Inbox work'] });
        const promoted = await repo.promoteInboxItem(inbox.id, project.id);
        await repo.upsertMissionSchedule(rest.id, {
          periodType: 'd',
          periodInterval: 1,
          timezone: 'UTC',
          daysOfWeek: [{ dayNum: 1, times: ['09:00:00'] }]
        });
        const done = (await repo.listProjectStatuses(project.id)).find(
          status => status.key === 'done'
        )!;
        await repo.updateMission(rest.id, { statusId: done.id });
        const rows = await db.all<{ id: string; summary_enabled: unknown }>(
          'SELECT id, summary_enabled FROM missions WHERE project_id = ?',
          [project.id]
        );
        assert.equal(
          rows.length,
          6,
          'REST, create, prompt, record-work, inbox promotion and scheduled duplicate'
        );
        for (const id of [
          rest.id,
          created.mission.id,
          prompted.mission.id,
          recorded.mission.id,
          promoted.id
        ])
          assert.ok(rows.some(row => row.id === id));
        assert.ok(
          rows.every(row => row.summary_enabled === true || Number(row.summary_enabled) === 1)
        );
        const missionId = created.mission.id;
        const generation = async () =>
          Number(
            (
              await db.get<{ n: number }>(
                'SELECT requested_generation AS n FROM mission_summaries WHERE mission_id = ?',
                [missionId]
              )
            )?.n ?? 0
          );
        const { channel } = await createSessionChannel({
          ctx,
          missionId,
          projectId: project.id,
          objectiveId: created.objectives[0]!.id
        });
        for (const kind of ['question', 'choice'] as const) {
          for (const transition of ['resolved', 'cancelled', 'released', 'timeout'] as const) {
            const before = await generation();
            const request = await createRequest({
              ctx,
              channel,
              kind,
              summary: `Choose ${transition}`,
              allowsFreeText: true,
              windowExpiresAt: transition === 'timeout' ? '2020-01-01T00:00:00.000Z' : null
            });
            assert.equal(await generation(), before + 1, `${kind} creation`);
            if (transition === 'resolved')
              await resolveRequest({ ctx, requestId: request.id, resolution: { text: 'Proceed' } });
            if (transition === 'cancelled') await cancelRequest({ ctx, requestId: request.id });
            if (transition === 'released')
              await releaseRequestToTerminal({ ctx, requestId: request.id, reason: 'interrupt' });
            if (transition === 'timeout') await releaseExpiredRequests({ ctx });
            assert.equal(await generation(), before + 2, `${kind} ${transition}`);
            await cancelRequest({ ctx, requestId: request.id });
            assert.equal(
              await generation(),
              before + 2,
              'terminal requests are not triggered twice'
            );
          }
        }
        for (const kind of ['permission', 'retry'] as const) {
          const before = await generation();
          const request = await createRequest({
            ctx,
            channel,
            kind,
            summary: 'Not summary evidence'
          });
          await cancelRequest({ ctx, requestId: request.id });
          assert.equal(await generation(), before);
        }
        await createRequest({ ctx, channel, kind: 'question', summary: 'Channel closing' });
        const beforeEnd = await generation();
        await endChannel({ ctx, channelId: channel.id, reason: 'session_ended' });
        assert.equal(await generation(), beforeEnd + 1);
      } finally {
        await cleanup();
      }
    });

    it('coalesces triggers without losing publication/completion races and rejects stale attempts', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_race');
      try {
        await bindWebappDatabaseClient({ client: db });
        const { createProject, createMission } = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const project = await createProject({ name: 'Race conformance' });
        const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
        const ctx = buildWebappServiceContext();
        const trigger = () =>
          db.transaction(tx =>
            enqueueMissionSummaryComposeJob({
              ctx: { ...ctx, db: tx },
              missionId: mission.id,
              reason: 'delivery_presented'
            })
          );
        const first = await trigger();
        const second = await trigger();
        assert.equal(first.jobId, second.jobId);
        assert.equal(second.generation, 2);
        const shell = await db.get<{ generated_at: string | null; headline: string }>(
          'SELECT generated_at, headline FROM mission_summaries WHERE mission_id = ?',
          [mission.id]
        );
        assert.deepEqual(shell, { generated_at: null, headline: '' });
        const job = await claimNextWorkerJob({
          db,
          jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
          workerId: 'race'
        });
        assert.ok(job);
        const publication = {
          status: 'composed' as const,
          headline: 'Current.',
          summary: 'Current evidence.',
          risks: [],
          suggestions: [],
          sourceDeliveryId: null,
          generatedBy: 'gemini' as const,
          model: 'test'
        };
        assert.equal(
          await publishMissionSummary({ db, missionId: mission.id, generation: 1, publication }),
          'stale'
        );
        assert.equal(
          await publishMissionSummary({ db, missionId: mission.id, generation: 2, publication }),
          'published'
        );
        assert.equal(
          await publishMissionSummary({
            db,
            missionId: mission.id,
            generation: 2,
            publication: { ...publication, headline: 'Late retry.' }
          }),
          'stale',
          'an expired attempt cannot replace a result already published for the same generation'
        );
        // Trigger after publication, before completion: completion must leave a successor.
        await trigger();
        const pending = await db.get<{ status: string; headline: string }>(
          'SELECT status, headline FROM mission_summaries WHERE mission_id = ?',
          [mission.id]
        );
        assert.deepEqual(pending, { status: 'pending', headline: 'Current.' });
        const completed = await completeMissionSummaryComposeJob({
          db,
          jobId: job.id,
          missionId: mission.id,
          status: 'succeeded'
        });
        assert.ok(completed.successorJobId);
        assert.notEqual(completed.successorJobId, job.id);
        assert.equal(
          await publishMissionSummary({
            db,
            missionId: mission.id,
            generation: 2,
            publication: { ...publication, headline: 'Stale.' }
          }),
          'stale'
        );
        assert.equal(
          await publishMissionSummary({ db, missionId: mission.id, generation: 3, publication }),
          'published'
        );
        await completeMissionSummaryComposeJob({
          db,
          jobId: completed.successorJobId!,
          missionId: mission.id,
          status: 'succeeded'
        });
        const afterCompletion = await trigger();
        assert.notEqual(afterCompletion.jobId, completed.successorJobId);
        assert.equal(afterCompletion.generation, 4);
        // The trigger and its event/job are atomic with the originating write.
        await assert.rejects(
          db.transaction(async tx => {
            await enqueueMissionSummaryComposeJob({
              ctx: { ...ctx, db: tx },
              missionId: mission.id,
              reason: 'objective_reopened'
            });
            throw new Error('rollback');
          }),
          /rollback/
        );
        const row = await db.get<{ requested_generation: number }>(
          'SELECT requested_generation FROM mission_summaries WHERE mission_id = ?',
          [mission.id]
        );
        assert.equal(Number(row?.requested_generation), 4);
        await db.run('UPDATE missions SET summary_enabled = ? WHERE id = ?', [
          adapter === 'postgres' ? false : 0,
          mission.id
        ]);
        assert.equal((await trigger()).triggered, false);
      } finally {
        await cleanup();
      }
    });
  });
}
