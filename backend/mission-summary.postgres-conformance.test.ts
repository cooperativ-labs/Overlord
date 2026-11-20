import { MISSION_SUMMARY_EVIDENCE_LIMIT } from '@overlord/contract';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildDeliveryReport } from '../packages/core/service/delivery-report.ts';
import { insertDeliveryMissionItems } from '../packages/core/service/mission-items.ts';
import { ensureMissionSummaryRow } from '../packages/core/service/mission-narrative.ts';
import { RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE } from '../packages/core/service/worker-jobs.ts';

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
        for (const file of [
          '20260907150000_human_action_resolutions.sql',
          '20260923090000_human_action_resolution_outcome.sql'
        ]) {
          await db.exec(
            readFileSync(
              new URL(`../database/${adapter}/migrations/${file}`, import.meta.url),
              'utf8'
            )
          );
        }
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
        // Historical evidence is read as-is; nothing composes prose for it.
        const { getMissionSummary } = await import('./mission-summary.ts');
        const historical = await getMissionSummary(old.id);
        assert.equal(historical.eligible, false);
        assert.equal(historical.narrative, null);
        assert.equal(
          Number(
            (
              await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM worker_jobs WHERE type = ?', [
                RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE
              ])
            )?.n
          ),
          0
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
        const { readMissionSummaryRuns } =
          await import('../packages/core/service/mission-summary-evidence.ts');
        const { setActiveWorkspaceUser } = await import('./db.ts');
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
          payload = objectiveId === quiet.id
            ? report
            : buildDeliveryReport({
                summary: 'Busy objective delivery.',
                deliveryReport: {
                  schemaVersion: 1,
                  agentReport: {
                    humanActions: [{ action: 'Enable export in production.', category: 'other' }]
                  }
                }
              })
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
          // The delivery path writes its items in the same transaction.
          await insertDeliveryMissionItems(db, {
            delivery: {
              id,
              workspaceId: mission.workspaceId,
              projectId: project.id,
              missionId: mission.id,
              objectiveId,
              deliveredAt: timestamp
            },
            report: payload,
            attribution: { actorWorkspaceUserId: null, actorTokenId: null, source: 'webapp' }
          });
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
        // The empty state row a delivery creates carries no prose.
        await ensureMissionSummaryRow(db, {
          id: mission.id,
          workspaceId: mission.workspaceId,
          projectId: project.id
        });
        const runs = await readMissionSummaryRuns(db, mission.id);
        assert.equal(runs.currentRun.length, 206);
        assert.ok(runs.currentRun.some(delivery => delivery.id === quietDelivery));
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
        const projected = await getMissionSummary(mission.id);
        assert.equal(projected.summary?.suggestions[0]?.state, 'open');
        assert.equal(projected.summary?.suggestions[0]?.deliveredAt, '2026-10-01T00:00:00.000Z');
        assert.ok(!projected.evidence?.sources.some(source => source.deliveryId === quietDelivery));
        await resolveDeferredWork(quietDelivery, ref.actionId, {
          status: 'done',
          outcome: 'objective_added',
          outcomeRef: 'test:1.abcd'
        });
        const resolved = (await getMissionSummary(mission.id)).summary!;
        assert.deepEqual(resolved.suggestions, []);
        assert.equal(resolved.closedItems[0]!.text, report.presentation.deferredWork[0]!.title);
        assert.equal(resolved.closedItems[0]!.status, 'done');
        assert.deepEqual((await getMissionSummary(mission.id)).summary?.suggestions, []);
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

    it('enables every creation path with summary eligibility', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_paths');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { protocolCreate, protocolPrompt, recordWork } =
          await import('../packages/core/service/protocol.ts');
        const project = await repo.createProject({ name: 'Creation paths' });
        const ctx = buildWebappServiceContext();
        const rest = await repo.createMission({ projectId: project.id, firstObjective: 'REST' });
        const created = await protocolCreate({
          ctx,
          projectId: project.id,
          objectives: [{ instructions: 'Protocol create' }]
        });
        const prompted = await protocolPrompt({
          ctx,
          projectId: project.id,
          objectives: [{ instructions: 'Protocol prompt' }],
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
        // Record-work without prose leaves one outstanding opportunity and no text.
        assert.equal(recorded.missionSummary?.publication?.available, true);
      } finally {
        await cleanup();
      }
    });

    it('questions, item decisions and presentation never touch the narrative; a reopen advances it', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_basis');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { attachSession, deliverSession } =
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
        const { closeMissionItemAsPerson, restoreMissionItemAsPerson } =
          await import('./mission-item-resolutions.ts');
        const { persistDeliveryPresentation, readDeliveryComposeContext } =
          await import('../packages/core/service/delivery-presentation.ts');
        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Narrative basis' });
        const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
        const objective = mission.objectives[0]!;
        const other = await repo.createObjective({ missionId: mission.id, instructionText: 'B' });
        const session = await attachSession({
          ctx,
          missionId: mission.id,
          objectiveId: objective.id
        });
        const delivered = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: session.sessionKey,
          summary: 'A is done.',
          payloadJson: {
            deliveryReport: { schemaVersion: 1, agentReport: { knownRisks: ['A risk.'] } }
          }
        });
        assert.equal(delivered.missionSummary?.publication?.available, true);

        const state = async () => {
          const row = await db.get<{ evidence_revision: number; revision: number }>(
            'SELECT evidence_revision, revision FROM mission_summaries WHERE mission_id = ?',
            [mission.id]
          );
          const jobs = await db.get<{ n: number }>(
            'SELECT COUNT(*) AS n FROM worker_jobs WHERE type = ?',
            [RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE]
          );
          return {
            evidence: Number(row?.evidence_revision),
            revision: Number(row?.revision),
            jobs: Number(jobs?.n)
          };
        };
        const baseline = await state();
        assert.deepEqual(baseline, { evidence: 1, revision: baseline.revision, jobs: 0 });

        const { channel } = await createSessionChannel({
          ctx,
          missionId: mission.id,
          projectId: project.id,
          objectiveId: other.id
        });
        for (const kind of ['question', 'choice'] as const) {
          for (const transition of ['resolved', 'cancelled', 'released', 'timeout'] as const) {
            const request = await createRequest({
              ctx,
              channel,
              kind,
              summary: `Choose ${transition}`,
              allowsFreeText: true,
              windowExpiresAt: transition === 'timeout' ? '2020-01-01T00:00:00.000Z' : null
            });
            if (transition === 'resolved')
              await resolveRequest({ ctx, requestId: request.id, resolution: { text: 'Proceed' } });
            if (transition === 'cancelled') await cancelRequest({ ctx, requestId: request.id });
            if (transition === 'released')
              await releaseRequestToTerminal({ ctx, requestId: request.id, reason: 'interrupt' });
            if (transition === 'timeout') await releaseExpiredRequests({ ctx });
            assert.deepEqual(await state(), baseline, `${kind} ${transition}`);
          }
        }
        await createRequest({ ctx, channel, kind: 'question', summary: 'Channel closing' });
        await endChannel({ ctx, channelId: channel.id, reason: 'session_ended' });
        assert.deepEqual(await state(), baseline, 'channel end');

        const risk = (await db.get<{ id: string }>(
          `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
          [mission.id]
        ))!;
        await closeMissionItemAsPerson({
          itemId: risk.id,
          workspaceId: mission.workspaceId,
          workspaceUserId: 'operator-workspace-user',
          status: 'done',
          reason: 'Fixed.'
        });
        await restoreMissionItemAsPerson({
          itemId: risk.id,
          workspaceId: mission.workspaceId,
          workspaceUserId: 'operator-workspace-user'
        });
        assert.deepEqual(await state(), baseline, 'item close and restore');

        const compose = (await readDeliveryComposeContext(db, delivered.deliveryId))!;
        await persistDeliveryPresentation({
          db,
          delivery: compose.delivery,
          nextReport: {
            ...compose.report,
            presentation: { ...compose.report.presentation, status: 'composed' }
          },
          changedFields: ['payload_json'],
          resolveChangeAttribution: async () => ({
            actorWorkspaceUserId: null,
            actorTokenId: null,
            source: 'runner'
          })
        });
        assert.deepEqual(await state(), baseline, 'delivery presentation persisted');

        // A REST reopen starts a new basis and supersedes the open opportunity.
        await repo.updateObjective(objective.id, { state: 'draft' });
        const reopened = await state();
        assert.equal(reopened.evidence, 2);
        assert.equal(reopened.jobs, 0);
        const publication = await db.get<{ superseded_reason: string | null }>(
          'SELECT superseded_reason FROM delivery_summary_publications WHERE delivery_id = ?',
          [delivered.deliveryId]
        );
        assert.equal(publication?.superseded_reason, 'reopened');
      } finally {
        await cleanup();
      }
    });

    it('fences out automatic jobs and non-agent narrative writes from older replicas', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_fence');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { attachSession, deliverSession } =
          await import('../packages/core/service/protocol.ts');
        const { getMissionSummary } = await import('./mission-summary.ts');
        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Fence' });
        const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
        const session = await attachSession({
          ctx,
          missionId: mission.id,
          objectiveId: mission.objectives[0]!.id
        });
        await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: session.sessionKey,
          summary: 'Done.',
          missionSummary: {
            baseContentRevision: 0,
            baseEvidenceRevision: 0,
            headline: 'Agent text.',
            summary: 'Verified.'
          }
        });
        assert.equal((await getMissionSummary(mission.id)).narrative?.state, 'current');
        const now = '2026-11-18T12:00:00.000Z';
        const job = (id: string, status: string) =>
          db.run(
            `INSERT INTO worker_jobs (id, workspace_id, type, status, priority, run_after, attempt_count,
               max_attempts, payload_json, created_at, updated_at, revision)
             VALUES (?, ?, ?, ?, 50, ?, 0, 5, '{"missionId":"x"}', ?, ?, 1)`,
            [
              id,
              mission.workspaceId,
              RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE,
              status,
              now,
              now,
              now
            ]
          );
        await job('old-queued', 'queued');
        await job('old-cancelled', 'cancelled');
        await db.run(`UPDATE worker_jobs SET status = 'succeeded' WHERE id = 'old-cancelled'`);
        const jobs = await db.all<{ id: string; status: string }>(
          'SELECT id, status FROM worker_jobs WHERE type = ? ORDER BY id',
          [RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE]
        );
        assert.deepEqual(
          jobs.map(row => [row.id, row.status]),
          [['old-cancelled', 'cancelled']]
        );

        const row = () =>
          db.get<{
            headline: string;
            status: string;
            generated_by: string;
            content_revision: number;
            published_evidence_revision: number | null;
          }>(
            `SELECT headline, status, generated_by, content_revision, published_evidence_revision
               FROM mission_summaries WHERE mission_id = ?`,
            [mission.id]
          );
        await db.run(
          `UPDATE mission_summaries SET headline = 'Model text.', generated_by = 'gemini',
             content_revision = content_revision + 1, narrative_delivery_id = NULL
           WHERE mission_id = ?`,
          [mission.id]
        );
        await db.run(`UPDATE mission_summaries SET status = 'pending' WHERE mission_id = ?`, [
          mission.id
        ]);
        const fenced = await row();
        assert.deepEqual(
          [
            fenced?.headline,
            fenced?.status,
            fenced?.generated_by,
            Number(fenced?.content_revision)
          ],
          ['Agent text.', 'composed', 'agent', 1]
        );
        const other = await repo.createMission({ projectId: project.id, firstObjective: 'B' });
        await db.run(
          `INSERT INTO mission_summaries (mission_id, workspace_id, project_id, status, generated_by,
             headline, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', 'deterministic', '', ?, ?)`,
          [other.id, other.workspaceId, project.id, now, now]
        );
        assert.equal(
          await db.get('SELECT mission_id FROM mission_summaries WHERE mission_id = ?', [other.id]),
          undefined
        );

        // An older replica's inline agent write carries no publication time: legacy.
        await db.run(
          `UPDATE mission_summaries SET headline = 'Old replica agent text.',
             content_revision = content_revision + 1, generated_at = ?
           WHERE mission_id = ?`,
          [now, mission.id]
        );
        const unverified = await row();
        assert.equal(unverified?.headline, 'Old replica agent text.');
        assert.equal(unverified?.published_evidence_revision, null);
        const response = await getMissionSummary(mission.id);
        assert.equal(response.narrative?.state, 'legacy');
        assert.equal(response.narrativeWatermark, now);
      } finally {
        await cleanup();
      }
    });

    it('narrative changes strictly advance the watermark and bound the seen marker', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_nwm');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { attachSession, deliverSession } =
          await import('../packages/core/service/protocol.ts');
        const { advanceMissionNarrativeEvidence } =
          await import('../packages/core/service/mission-narrative.ts');
        const { publishDeliverySummary } =
          await import('../packages/core/service/delivery-summary-publication.ts');
        const { getMissionSummary, markMissionSummarySeen } = await import('./mission-summary.ts');
        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Narrative watermark' });
        const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
        const session = await attachSession({
          ctx,
          missionId: mission.id,
          objectiveId: mission.objectives[0]!.id
        });
        const delivered = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: session.sessionKey,
          summary: 'Done.'
        });
        // Every write below happens in the same millisecond.
        const now = '2030-01-01T00:00:00.000Z';
        const changedAt = async () =>
          (await getMissionSummary(mission.id)).narrativeWatermark as string;
        const advance = () =>
          db.transaction(tx =>
            advanceMissionNarrativeEvidence(tx, {
              mission: { id: mission.id },
              reason: 'source_deleted',
              attribution: { actorWorkspaceUserId: null, source: 'webapp' },
              now
            })
          );
        await advance();
        const first = await changedAt();
        await advance();
        const second = await changedAt();
        assert.equal(first, now);
        assert.equal(Date.parse(second) - Date.parse(first), 1);
        // The basis moved past the delivery, so its opportunity is gone.
        await assert.rejects(
          publishDeliverySummary({
            ctx,
            missionId: mission.id,
            deliveryId: delivered.deliveryId,
            sessionKey: session.sessionKey,
            operationId: 'publish-nwm-0001',
            narrative: {
              baseContentRevision: 0,
              baseEvidenceRevision: 3,
              headline: 'Late.',
              summary: 'Late.'
            },
            now
          }),
          (error: { code?: string }) => error.code === 'mission_summary_publication_superseded'
        );

        const response = await getMissionSummary(mission.id);
        assert.equal(response.narrative?.state, 'absent');
        await assert.rejects(
          markMissionSummarySeen(mission.id, {
            watermark: new Date(Date.parse(second) + 1).toISOString()
          }),
          (error: { code?: string }) => error.code === 'invalid_input'
        );
        assert.deepEqual(
          await markMissionSummarySeen(mission.id, { watermark: response.narrativeWatermark! }),
          { seenAt: second }
        );
      } finally {
        await cleanup();
      }
    });

    it(
      'a publication racing a newer delivery serializes on the mission lock',
      { skip: adapter !== 'postgres' },
      async () => {
        const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_summary_race');
        try {
          await bindWebappDatabaseClient({ client: db });
          const repo = await import('./repository.ts');
          const { buildWebappServiceContext } = await import('./db.ts');
          const { attachSession, deliverSession } =
            await import('../packages/core/service/protocol.ts');
          const { publishDeliverySummary } =
            await import('../packages/core/service/delivery-summary-publication.ts');
          const { getMissionSummary } = await import('./mission-summary.ts');
          const ctx = buildWebappServiceContext();
          const project = await repo.createProject({ name: 'Publication race' });
          const outcomes = { published: 0, superseded: 0 };
          for (let round = 0; round < 6; round++) {
            const mission = await repo.createMission({
              projectId: project.id,
              firstObjective: `A${round}`
            });
            const second = await repo.createObjective({
              missionId: mission.id,
              instructionText: `B${round}`
            });
            const a = await attachSession({
              ctx,
              missionId: mission.id,
              objectiveId: mission.objectives[0]!.id
            });
            const b = await attachSession({ ctx, missionId: mission.id, objectiveId: second.id });
            const delivered = await deliverSession({
              ctx,
              missionId: mission.id,
              sessionKey: a.sessionKey,
              summary: 'A.'
            });
            const [publish, newer] = await Promise.allSettled([
              publishDeliverySummary({
                ctx,
                missionId: mission.id,
                deliveryId: delivered.deliveryId,
                sessionKey: a.sessionKey,
                operationId: `publish-race-${round}-0001`,
                narrative: {
                  baseContentRevision: 0,
                  baseEvidenceRevision: 1,
                  headline: 'A landed.',
                  summary: 'A is tested.'
                }
              }),
              deliverSession({
                ctx,
                missionId: mission.id,
                sessionKey: b.sessionKey,
                summary: 'B.'
              })
            ]);
            assert.equal(newer.status, 'fulfilled', 'the newer delivery is always accepted');
            const response = await getMissionSummary(mission.id);
            assert.equal(response.narrative?.evidenceRevision, 2);
            assert.notEqual(response.narrative?.state, 'current');
            const row = await db.get<{
              published_at: unknown;
              superseded_reason: string | null;
            }>(
              'SELECT published_at, superseded_reason FROM delivery_summary_publications WHERE delivery_id = ?',
              [delivered.deliveryId]
            );
            if (publish.status === 'fulfilled') {
              outcomes.published += 1;
              assert.equal(response.narrative?.state, 'outdated');
              assert.equal(response.narrative?.publishedEvidenceRevision, 1);
              assert.ok(row?.published_at);
              assert.equal(row?.superseded_reason, null);
            } else {
              outcomes.superseded += 1;
              assert.equal(
                (publish.reason as { code?: string }).code,
                'mission_summary_publication_superseded'
              );
              assert.equal(response.narrative?.state, 'absent');
              assert.equal(row?.published_at, null);
              assert.equal(row?.superseded_reason, 'newer_delivery');
            }
          }
          assert.equal(outcomes.published + outcomes.superseded, 6);
        } finally {
          await cleanup();
        }
      }
    );
  });
}
