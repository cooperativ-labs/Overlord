import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Replay-safe finalization (coo:1297.hk2v, ADR 0075) behaves identically on
 * both editions. On Postgres the pool has several connections, so the
 * concurrent cases really race: the mission lock serializes deliveries of one
 * session, and record-work races serialize on the receipt's unique index with
 * the losing creation rolled back whole.
 */

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

for (const adapter of conformanceAdapters()) {
  describe(`replay-safe delivery finalization [${adapter}]`, () => {
    it('replays lost responses, refuses changed bodies and finalizes a session once', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_finalize');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { attachSession, deliverSession } =
          await import('../packages/core/service/protocol.ts');
        const { readDeliveryReceipt } =
          await import('../packages/core/service/delivery-finalization.ts');

        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Finalization' });
        const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
        const [first] = mission.objectives;
        const session = await attachSession({ ctx, missionId: mission.id, objectiveId: first!.id });

        // Two different operation ids race for one session: exactly one wins.
        const race = await Promise.allSettled(
          ['op-pg-race-a01', 'op-pg-race-b01'].map(operationId =>
            deliverSession({
              ctx,
              missionId: mission.id,
              sessionKey: session.sessionKey,
              summary: `Attempt ${operationId}`,
              operationId
            })
          )
        );
        const won = race.filter(result => result.status === 'fulfilled');
        const lost = race.filter(result => result.status === 'rejected');
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.equal(
          errorCode((lost[0] as PromiseRejectedResult).reason),
          'delivery_already_accepted'
        );
        const winner = (
          won[0] as PromiseFulfilledResult<{ deliveryId: string; operationId: string }>
        ).value;

        // Lost response: the winner's retry returns its receipt after session end.
        const replay = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: session.sessionKey,
          summary: `Attempt ${winner.operationId}`,
          operationId: winner.operationId
        });
        assert.equal(replay.deliveryId, winner.deliveryId);
        assert.equal(replay.replayed, true);

        // Same id with a different body is a conflict, not a second delivery.
        await assert.rejects(
          deliverSession({
            ctx,
            missionId: mission.id,
            sessionKey: session.sessionKey,
            summary: 'Changed body',
            operationId: winner.operationId
          }),
          (error: unknown) => errorCode(error) === 'delivery_operation_conflict'
        );

        const counts = await db.get<{ deliveries: number; receipts: number }>(
          `SELECT (SELECT COUNT(*) FROM deliveries WHERE mission_id = ?) AS deliveries,
                  (SELECT COUNT(*) FROM delivery_finalizations WHERE mission_id = ?) AS receipts`,
          [mission.id, mission.id]
        );
        assert.equal(Number(counts?.deliveries), 1);
        assert.equal(Number(counts?.receipts), 1);

        const receipt = await readDeliveryReceipt({ ctx, operationId: winner.operationId });
        assert.equal(receipt.receipt.deliveryId, winner.deliveryId);
        assert.match(receipt.receipt.acceptedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

        // Revocation of project scope removes replay and receipt access.
        const revoked = { ...ctx, allowedProjectIds: [] as string[] };
        await assert.rejects(
          deliverSession({
            ctx: revoked,
            missionId: mission.id,
            sessionKey: session.sessionKey,
            summary: `Attempt ${winner.operationId}`,
            operationId: winner.operationId
          })
        );
        await assert.rejects(
          readDeliveryReceipt({ ctx: revoked, operationId: winner.operationId }),
          (error: unknown) => errorCode(error) === 'delivery_receipt_not_found'
        );

        // Receipts are immutable on both editions.
        await assert.rejects(
          db.run(`UPDATE delivery_finalizations SET request_digest = ? WHERE mission_id = ?`, [
            'v1:tampered-digest',
            mission.id
          ]),
          /immutable/
        );
      } finally {
        await cleanup();
      }
    });

    it('serializes concurrent same-operation record-work on the receipt', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_finalize_rw');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { recordWork } = await import('../packages/core/service/protocol.ts');

        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Record work race' });
        const request = {
          ctx,
          projectId: project.id,
          objective: 'Document the retry rule.',
          summary: 'Documented the retry rule.',
          operationId: 'op-pg-record-01'
        };
        const results = await Promise.all([
          recordWork(request),
          recordWork(request),
          recordWork(request)
        ]);
        assert.equal(new Set(results.map(result => result.mission.id)).size, 1);
        assert.equal(new Set(results.map(result => result.deliveryId)).size, 1);
        const missions = await db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM missions WHERE project_id = ?`,
          [project.id]
        );
        assert.equal(Number(missions?.n), 1, 'losing creations rolled back whole');
        const objectives = await db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM objectives o JOIN missions m ON m.id = o.mission_id
            WHERE m.project_id = ?`,
          [project.id]
        );
        assert.equal(Number(objectives?.n), 1);

        // An intentionally separate identical record under a new id is new work.
        const separate = await recordWork({ ...request, operationId: 'op-pg-record-02' });
        assert.notEqual(separate.mission.id, results[0]!.mission.id);
      } finally {
        await cleanup();
      }
    });
  });
}
