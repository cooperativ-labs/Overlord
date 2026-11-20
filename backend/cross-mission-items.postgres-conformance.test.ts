import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ServiceContext } from '../packages/core/service/context.ts';
import {
  publishDeliverySummary,
  readDeliverySummaryContext
} from '../packages/core/service/delivery-summary-publication.ts';
import {
  closedElsewhere,
  getMissionItem,
  restoreMissionItem
} from '../packages/core/service/mission-items.ts';
import { addObjectivesToMission } from '../packages/core/service/missions.ts';
import { lockMissionObjectiveQueue } from '../packages/core/service/objective-queue.ts';
import { createProject } from '../packages/core/service/projects.ts';
import {
  attachSession,
  closeAgentMissionItems,
  deliverSession,
  readAgentProjectItems,
  recordWork,
  updateSession
} from '../packages/core/service/protocol.ts';
import {
  createSeededServiceContext,
  seedServiceOperator
} from '../packages/core/service/test-helpers.ts';

import { createConformanceDatabase } from './test-helpers.ts';

for (const adapter of ['sqlite', 'postgres'] as const) {
  test(
    `cross-mission acceptance, provenance, isolation and reciprocal locks [${adapter}]`,
    {
      skip: adapter === 'postgres' && !process.env.TEST_DATABASE_URL,
      timeout: 60_000
    },
    async t => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_cross_items');
      try {
        const { ctx } = await createSeededServiceContext({ db });
        const project = await createProject({ ctx, name: 'Cross-mission' });
        const attribution = {
          source: 'protocol' as const,
          actorWorkspaceUserId: ctx.actorWorkspaceUserId,
          actorTokenId: null
        };
        const close = (id: string) => ({
          id,
          status: 'done' as const,
          reason: 'Verified the implementation.'
        });
        let n = 0;
        async function fixture(projectId = project.id) {
          const tag = `fixture-${++n}`;
          const recorded = await recordWork({
            ctx,
            projectId,
            objective: tag,
            summary: tag,
            missionSummary: { headline: tag, summary: 'Verified local behavior.' },
            payloadJson: {
              deliveryReport: {
                schemaVersion: 1,
                agentReport: {
                  knownRisks: [`${tag} risk 1`, `${tag} risk 2`, `${tag} risk 3`]
                }
              }
            }
          });
          const [objective] = await addObjectivesToMission({
            ctx,
            missionId: recorded.mission.id,
            objectives: [{ instructions: 'Resolve remaining work' }]
          });
          const session = await attachSession({
            ctx,
            missionId: recorded.mission.id,
            objectiveId: objective!.id
          });
          const items = await db.all<{ id: string }>(
            'SELECT id FROM mission_items WHERE mission_id = ? ORDER BY id',
            [recorded.mission.id]
          );
          return {
            mission: recorded.mission,
            sessionKey: session.sessionKey,
            sessionId: session.session.id,
            objectiveId: objective!.id,
            items,
            baseline: session.missionSummary!,
            recorded
          };
        }
        async function targetState(missionId: string) {
          return {
            summary: await db.get('SELECT * FROM mission_summaries WHERE mission_id = ?', [
              missionId
            ]),
            publications: await db.all(
              'SELECT * FROM delivery_summary_publications WHERE mission_id = ? ORDER BY id',
              [missionId]
            )
          };
        }
        await t.test(
          'project discovery reads accepted rows and honors scope on both adapters',
          async () => {
            const source = await fixture();
            const target = await fixture();
            const scope = { ctx, missionId: source.mission.id, sessionKey: source.sessionKey };
            const page = await readAgentProjectItems({
              ...scope,
              query: 'risk',
              kinds: ['risk'],
              paths: ['backend/services/retry.ts']
            });
            assert.equal(page.responseShapeVersion, 1);
            assert.equal(page.total, 3);
            assert.ok(
              page.items.every(item => item.mission.displayId === target.mission.displayId)
            );
            assert.equal(
              (await readAgentProjectItems({ ...scope, includeOwnMission: true })).total,
              6
            );
            await assert.rejects(
              readAgentProjectItems({ ...scope, ctx: { ...ctx, allowedProjectIds: [] } })
            );
            await db.run('UPDATE agent_sessions SET ended_at = ? WHERE id = ?', [
              new Date().toISOString(),
              source.sessionId
            ]);
            await assert.rejects(readAgentProjectItems(scope));
            await db.run('UPDATE deliveries SET deleted_at = ? WHERE id IN (?,?)', [
              new Date().toISOString(),
              source.recorded.deliveryId,
              target.recorded.deliveryId
            ]);
          }
        );

        await t.test(
          'standalone decisions link once; stale prose, receipt replay and publication do not repeat item writes',
          async () => {
            const a = await fixture(),
              b = await fixture();
            const before = await targetState(b.mission.id);
            const closed = await closeAgentMissionItems({
              ctx,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              closeItems: [close(b.items[0]!.id)]
            });
            assert.deepEqual(closed.targets, [
              { missionDisplayId: b.mission.displayId, closed: 1 }
            ]);
            let item = (await getMissionItem(db, b.items[0]!.id))!;
            assert.equal(item.resolvedBy?.kind, 'agent');
            if (item.resolvedBy?.kind !== 'agent') throw new Error('Missing resolver');
            assert.equal(item.resolvedBy.missionId, a.mission.id);
            assert.equal(item.resolvedBy.objectiveId, a.objectiveId);
            assert.equal(item.resolvedBy.missionDisplayId, a.mission.displayId);
            assert.ok(item.resolvedBy.sessionId);
            assert.equal(item.resolvedBy.deliveryId, null);
            await assert.rejects(
              db.run("UPDATE mission_items SET resolved_by_kind = 'person' WHERE id = ?", [item.id])
            );
            assert.deepEqual(await targetState(b.mission.id), before);
            const request = {
              ctx,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              operationId: 'op-cross-standalone-001',
              summary: 'Resolution accepted.',
              missionSummary: {
                baseContentRevision: 999,
                baseEvidenceRevision: 999,
                headline: 'Stale prose.',
                summary: 'Stale prose withheld.',
                closeItems: [close(b.items[1]!.id)]
              }
            };
            const accepted = await deliverSession(request);
            assert.equal(accepted.missionSummary!.publication!.withheldReason, 'stale_content');
            item = (await getMissionItem(db, item.id))!;
            assert.equal(
              item.resolvedBy?.kind === 'agent' && item.resolvedBy.deliveryId,
              accepted.deliveryId
            );
            const projection = await closedElsewhere(db, accepted.deliveryId, a.mission.id);
            assert.equal(projection.length, 2);
            const changes = await db.all('SELECT * FROM entity_changes ORDER BY seq');
            const receipt = await db.get(
              'SELECT * FROM delivery_finalizations WHERE delivery_id = ?',
              [accepted.deliveryId]
            );
            const replay = await deliverSession(request);
            assert.equal(replay.replayed, true);
            assert.equal(replay.deliveryId, accepted.deliveryId);
            assert.deepEqual(await db.all('SELECT * FROM entity_changes ORDER BY seq'), changes);
            const publication = await readDeliverySummaryContext({
              ctx,
              missionId: a.mission.id,
              deliveryId: accepted.deliveryId,
              sessionKey: a.sessionKey
            });
            const publish = {
              ctx,
              missionId: a.mission.id,
              deliveryId: accepted.deliveryId,
              sessionKey: a.sessionKey,
              operationId: 'op-cross-publication-001',
              narrative: {
                baseContentRevision: publication.baseline!.contentRevision,
                baseEvidenceRevision: publication.baseline!.evidenceRevision,
                headline: 'Resolved project items.',
                summary: 'Verified local decisions.'
              }
            };
            await assert.rejects(
              publishDeliverySummary({
                ...publish,
                narrative: { ...publish.narrative, closeItems: [close(b.items[2]!.id)] }
              })
            );
            await publishDeliverySummary(publish);
            assert.equal((await publishDeliverySummary(publish)).replayed, true);
            assert.deepEqual(
              await closedElsewhere(db, accepted.deliveryId, a.mission.id),
              projection
            );
            assert.deepEqual(await targetState(b.mission.id), before);
            assert.deepEqual(
              await db.get('SELECT * FROM delivery_finalizations WHERE delivery_id = ?', [
                accepted.deliveryId
              ]),
              receipt
            );
            await db.transaction(async tx => {
              await lockMissionObjectiveQueue(tx, b.mission.id);
              await restoreMissionItem(tx, { itemId: item.id, attribution });
            });
            assert.equal((await closedElsewhere(db, accepted.deliveryId, a.mission.id)).length, 1);
            await db.run('UPDATE deliveries SET deleted_at = ? WHERE id = ?', [
              new Date().toISOString(),
              b.recorded.deliveryId
            ]);
            assert.deepEqual(await closedElsewhere(db, accepted.deliveryId, a.mission.id), []);
          }
        );
        await t.test(
          'stale evidence, missing evidence basis and absent prose accept valid foreign closes',
          async () => {
            for (const reason of ['stale_evidence', 'missing_evidence_base', 'absent'] as const) {
              const a = await fixture(),
                b = await fixture();
              const before = await targetState(b.mission.id);
              const proposal =
                reason === 'absent'
                  ? {}
                  : {
                      headline: 'Verified project fix.',
                      summary: 'Tested locally.',
                      baseContentRevision: a.baseline.contentRevision,
                      ...(reason === 'stale_evidence' ? { baseEvidenceRevision: 999 } : {})
                    };
              const request = {
                ctx,
                missionId: a.mission.id,
                sessionKey: a.sessionKey,
                summary: 'Verified foreign close.',
                operationId: `op-cross-${reason}-001`,
                missionSummary: { ...proposal, closeItems: [close(b.items[0]!.id)] }
              };
              const accepted = await deliverSession(request);
              assert.equal(accepted.missionSummary!.publication!.withheldReason, reason);
              assert.deepEqual(accepted.missionSummary!.closedItemIds, [b.items[0]!.id]);
              assert.equal((await deliverSession(request)).replayed, true);
              assert.deepEqual(await targetState(b.mission.id), before);
            }
          }
        );
        await t.test(
          'forbidden foreign entries leave own closes and delivery valid; other projects and token scope are concealed',
          async () => {
            const a = await fixture(),
              b = await fixture();
            const otherProject = await createProject({ ctx, name: 'Other' });
            const foreign = await fixture(otherProject.id);
            const denied: ServiceContext = { ...ctx, canUpdateMissionItems: async () => false };
            const result = await deliverSession({
              ctx: denied,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              summary: 'Own close accepted.',
              missionSummary: {
                closeItems: [
                  close(a.items[0]!.id),
                  close(b.items[0]!.id),
                  close(foreign.items[0]!.id)
                ]
              }
            });
            assert.deepEqual(result.missionSummary!.closedItemIds, [a.items[0]!.id]);
            assert.match(
              result.missionSummary!.warnings.map(w => w.message).join(' '),
              /mission:update/
            );
            assert.match(
              result.missionSummary!.warnings.map(w => w.message).join(' '),
              /no item has this id/
            );
            assert.equal((await getMissionItem(db, b.items[0]!.id))!.status, 'open');
            await assert.rejects(
              closeAgentMissionItems({
                ctx: { ...ctx, allowedProjectIds: [otherProject.id] },
                missionId: b.mission.id,
                sessionKey: b.sessionKey,
                closeItems: [close(b.items[0]!.id)]
              })
            );
          }
        );
        await t.test(
          'foreign workspace ids and deleted source deliveries are uniformly not_found',
          async () => {
            const a = await fixture(),
              b = await fixture();
            await seedServiceOperator({
              db,
              workspaceId: 'foreign-workspace',
              workspaceUserId: 'foreign-user',
              profileId: 'foreign-profile'
            });
            const foreignCtx: ServiceContext = {
              ...ctx,
              workspace: { id: 'foreign-workspace', slug: 'foreign-workspace', name: 'Foreign' },
              actorWorkspaceUserId: 'foreign-user'
            };
            const foreignProject = await createProject({ ctx: foreignCtx, name: 'Foreign' });
            const foreign = await recordWork({
              ctx: foreignCtx,
              projectId: foreignProject.id,
              objective: 'Foreign report',
              summary: 'Foreign report.',
              payloadJson: {
                deliveryReport: {
                  schemaVersion: 1,
                  agentReport: { knownRisks: ['Foreign workspace risk.'] }
                }
              }
            });
            const hidden = (await db.get<{ id: string }>(
              'SELECT id FROM mission_items WHERE mission_id = ?',
              [foreign.mission.id]
            ))!;
            await db.run('UPDATE deliveries SET deleted_at = ? WHERE id = ?', [
              new Date().toISOString(),
              b.recorded.deliveryId
            ]);
            const result = await closeAgentMissionItems({
              ctx,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              closeItems: [close(hidden.id), close(b.items[0]!.id), close('unknown-item')]
            });
            assert.deepEqual(result.closedItemIds, []);
            assert.deepEqual(result.targets, []);
            assert.deepEqual(
              result.warnings.map(w => w.problem),
              ['not_found', 'not_found', 'not_found']
            );
          }
        );
        await t.test(
          'person restore fences foreign agents but permits own agents; reciprocal restore race serializes',
          async () => {
            const a = await fixture(),
              b = await fixture();
            const request = {
              ctx,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              closeItems: [close(b.items[0]!.id)]
            };
            await closeAgentMissionItems(request);
            await Promise.all([
              db.transaction(async tx => {
                await lockMissionObjectiveQueue(tx, b.mission.id);
                await restoreMissionItem(tx, { itemId: b.items[0]!.id, attribution });
              }),
              closeAgentMissionItems(request)
            ]);
            const item = (await getMissionItem(db, b.items[0]!.id))!;
            assert.equal(item.status, 'open');
            assert.ok(item.restoredAt);
            const refused = await closeAgentMissionItems(request);
            assert.match(refused.warnings[0]!.message, /a person restored/);
            const own = await closeAgentMissionItems({
              ctx,
              missionId: b.mission.id,
              sessionKey: b.sessionKey,
              closeItems: request.closeItems
            });
            assert.equal(own.closedItemIds.length, 1);
            assert.equal((await getMissionItem(db, item.id))!.restoredAt, item.restoredAt);
          }
        );
        await t.test(
          'draft CAS failure rolls back acceptance and foreign close; valid seal links once',
          async () => {
            const a = await fixture(),
              b = await fixture();
            await updateSession({
              ctx,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              summary: '',
              reportDraft: {
                operationId: 'op-cross-draft-001',
                expectedRevision: 0,
                operations: [
                  {
                    op: 'upsert',
                    entryId: 'risk-1',
                    kind: 'known_risk',
                    content: { text: 'Draft observation.' }
                  }
                ]
              }
            });
            const request = {
              ctx,
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              operationId: 'op-cross-draft-final-001',
              summary: 'Seal report.',
              missionSummary: { closeItems: [close(b.items[0]!.id)] },
              reportDraft: { expectedRevision: 0 }
            };
            await assert.rejects(deliverSession(request));
            assert.equal((await getMissionItem(db, b.items[0]!.id))!.status, 'open');
            assert.equal(
              (await db.get<{ sealed_at: string | null }>(
                'SELECT sealed_at FROM delivery_report_drafts WHERE session_id = ?',
                [a.sessionId]
              ))!.sealed_at,
              null
            );
            const valid = { ...request, reportDraft: { expectedRevision: 1 } };
            const accepted = await deliverSession(valid);
            assert.equal((await closedElsewhere(db, accepted.deliveryId, a.mission.id)).length, 1);
            assert.equal((await deliverSession(valid)).replayed, true);
          }
        );
        await t.test(
          'record-work uses the new delivery directly with no session provenance or history',
          async () => {
            const b = await fixture();
            const before = await targetState(b.mission.id);
            const request = {
              ctx,
              projectId: project.id,
              objective: 'Completed independent work',
              summary: 'Verified fix.',
              operationId: 'op-cross-record-work-001',
              missionSummary: { closeItems: [close(b.items[0]!.id)] }
            };
            const accepted = await recordWork(request);
            const resolver = (await getMissionItem(db, b.items[0]!.id))!.resolvedBy;
            assert.equal(resolver?.kind === 'agent' && resolver.missionId, accepted.mission.id);
            assert.equal(resolver?.kind === 'agent' && resolver.sessionId, null);
            assert.equal(resolver?.kind === 'agent' && resolver.deliveryId, accepted.deliveryId);
            assert.equal((await recordWork(request)).replayed, true);
            assert.deepEqual(await targetState(b.mission.id), before);
          }
        );
        await t.test(
          'delivery restarts if a concurrent standalone close adds a session-link target',
          {
            skip: adapter !== 'postgres'
          },
          async () => {
            const a = await fixture(),
              b = await fixture();
            let reached!: () => void, release!: () => void;
            const waiting = new Promise<void>(resolve => {
              reached = resolve;
            });
            const resume = new Promise<void>(resolve => {
              release = resolve;
            });
            let intercepted = false,
              transactions = 0;
            const wrap = (client: typeof db): typeof db =>
              new Proxy(client, {
                get(target, key) {
                  if (key === 'transaction')
                    return (fn: (tx: typeof db) => Promise<unknown>) => {
                      transactions++;
                      return target.transaction(tx => fn(wrap(tx)));
                    };
                  if (key === 'get')
                    return async (sql: string, params?: unknown[]) => {
                      if (
                        !intercepted &&
                        sql.includes('FROM missions') &&
                        sql.includes('FOR UPDATE')
                      ) {
                        intercepted = true;
                        reached();
                        await resume;
                      }
                      return target.get(sql, params);
                    };
                  const value = Reflect.get(target, key);
                  return typeof value === 'function' ? value.bind(target) : value;
                }
              });
            const acceptance = deliverSession({
              ctx: { ...ctx, db: wrap(db) },
              missionId: a.mission.id,
              sessionKey: a.sessionKey,
              summary: 'Link the concurrently closed item.'
            });
            await waiting;
            try {
              await closeAgentMissionItems({
                ctx,
                missionId: a.mission.id,
                sessionKey: a.sessionKey,
                closeItems: [close(b.items[0]!.id)]
              });
            } finally {
              release();
            }
            const result = await acceptance;
            assert.ok(transactions >= 2, 'changed target set restarted the transaction');
            assert.equal((await closedElsewhere(db, result.deliveryId, a.mission.id)).length, 1);
          }
        );
        await t.test(
          'reciprocal standalone closes, deliveries and prior-session linking complete without deadlocks',
          async () => {
            const a = await fixture(),
              b = await fixture();
            await Promise.all([
              closeAgentMissionItems({
                ctx,
                missionId: a.mission.id,
                sessionKey: a.sessionKey,
                closeItems: [close(b.items[0]!.id)]
              }),
              closeAgentMissionItems({
                ctx,
                missionId: b.mission.id,
                sessionKey: b.sessionKey,
                closeItems: [close(a.items[0]!.id)]
              })
            ]);
            const [da, dbb] = await Promise.all([
              deliverSession({
                ctx,
                missionId: a.mission.id,
                sessionKey: a.sessionKey,
                summary: 'A closes B.',
                missionSummary: { closeItems: [close(b.items[1]!.id)] }
              }),
              deliverSession({
                ctx,
                missionId: b.mission.id,
                sessionKey: b.sessionKey,
                summary: 'B closes A.',
                missionSummary: { closeItems: [close(a.items[1]!.id)] }
              })
            ]);
            assert.equal((await closedElsewhere(db, da.deliveryId, a.mission.id)).length, 2);
            assert.equal((await closedElsewhere(db, dbb.deliveryId, b.mission.id)).length, 2);
          }
        );
        const narrativeJobs = await db.get<{ n: number | string }>(
          "SELECT COUNT(*) AS n FROM worker_jobs WHERE type = 'overlord.mission.summary.compose.v1'"
        );
        assert.equal(Number(narrativeJobs!.n), 0);
      } finally {
        await cleanup();
      }
    }
  );
}
