import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import {
  blockRunQueueEntry,
  dropRunQueueEntry,
  enqueueRunQueueEntry,
  holdRunQueueEntry,
  markRunQueueEntryDispatched,
  markRunQueueEntryRunning,
  moveRunQueueEntry,
  recordRunQueueDispatchFailure,
  removeRunQueueEntry,
  resetWedgedLaunchingObjective,
  retryRunQueueEntry
} from './run-queue.js';
import { createSeededServiceContext } from './test-helpers.js';

type Row = {
  state: string;
  waiting_reason: string | null;
  waiting_on_objective_id: string | null;
  blocked_reason: string | null;
  execution_request_id: string | null;
  attempt_count: number;
  dispatched_at: string | null;
  deleted_at: string | null;
  revision: number;
};

async function queuedObjective() {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  const project = await createProject({ ctx, name: `Transitions ${randomUUID()}` });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'First' }, { objective: 'Second' }]
  });
  const entry = await enqueueRunQueueEntry(db, project.id, objectives[0]!.id);
  const row = async () =>
    (await db.get<Row>(
      `SELECT state, waiting_reason, waiting_on_objective_id, blocked_reason, execution_request_id,
              attempt_count, dispatched_at, deleted_at, revision
         FROM run_queue_entries WHERE id = ?`,
      [entry.id]
    ))!;
  const set = (sql: string, params: unknown[] = []) =>
    db.run(`UPDATE run_queue_entries SET ${sql} WHERE id = ?`, [...params, entry.id]);
  const insertRequest = async (status: string) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO execution_requests
         (id, workspace_id, project_id, mission_id, objective_id, launch_mode, requested_source,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'run', 'webapp', ?, ?, ?)`,
      [id, ctx.workspace.id, project.id, mission.id, objectives[0]!.id, status, now, now]
    );
    return id;
  };
  const objectiveState = async () =>
    (await db.get<{ state: string }>('SELECT state FROM objectives WHERE id = ?', [
      objectives[0]!.id
    ]))!.state;
  return { db, entry, objectives, row, set, insertRequest, objectiveState };
}

const NOW = '2026-09-28T12:00:00.000Z';

describe('Run Queue entry transitions', () => {
  it('drop soft-deletes once', async () => {
    const { db, entry, row } = await queuedObjective();
    await dropRunQueueEntry(db, entry.id, NOW);
    const dropped = await row();
    assert.equal(dropped.deleted_at, NOW);
    await dropRunQueueEntry(db, entry.id, '2026-09-28T13:00:00.000Z');
    assert.equal((await row()).deleted_at, NOW, 'a dropped entry stays dropped at its first time');
    assert.equal((await row()).revision, dropped.revision);
  });

  it('hold clears the failure detail unless asked to keep it', async () => {
    const { db, entry, objectives, row, set } = await queuedObjective();
    await set("blocked_reason = 'dispatch_failed: boom', attempt_count = 2");
    await holdRunQueueEntry(db, entry.id, NOW, {
      reason: 'retry_pending',
      keepFailureDetail: true
    });
    assert.equal((await row()).blocked_reason, 'dispatch_failed: boom');
    await holdRunQueueEntry(db, entry.id, NOW, {
      reason: 'mission_busy',
      waitingOnObjectiveId: objectives[1]!.id
    });
    const held = await row();
    assert.equal(held.state, 'waiting');
    assert.equal(held.waiting_reason, 'mission_busy');
    assert.equal(held.waiting_on_objective_id, objectives[1]!.id);
    assert.equal(held.blocked_reason, null);
    assert.equal(held.attempt_count, 2);
  });

  it('hold with resetAttempts refunds the budget and drops the request link', async () => {
    const { db, entry, row, set, insertRequest } = await queuedObjective();
    await set(
      "state = 'blocked', blocked_reason = 'dispatch_failed', attempt_count = 3, execution_request_id = ?",
      [await insertRequest('expired')]
    );
    await holdRunQueueEntry(db, entry.id, NOW, { reason: 'retry_pending', resetAttempts: true });
    const retried = await row();
    assert.equal(retried.state, 'waiting');
    assert.equal(retried.waiting_reason, 'retry_pending');
    assert.equal(retried.blocked_reason, null);
    assert.equal(retried.attempt_count, 0);
    assert.equal(retried.execution_request_id, null);
  });

  it('block keeps an existing failure detail only when asked, and falls back to the reason', async () => {
    const { db, entry, row, set } = await queuedObjective();
    await set("waiting_reason = 'retry_pending', blocked_reason = 'request_failed: gone'");
    await blockRunQueueEntry(db, entry.id, NOW, {
      reason: 'request_failed',
      keepFailureDetail: true
    });
    const kept = await row();
    assert.equal(kept.state, 'blocked');
    assert.equal(kept.blocked_reason, 'request_failed: gone');
    assert.equal(kept.waiting_reason, null);
    assert.equal(kept.waiting_on_objective_id, null);

    await set('blocked_reason = NULL');
    await blockRunQueueEntry(db, entry.id, NOW, {
      reason: 'dispatch_failed',
      keepFailureDetail: true
    });
    assert.equal((await row()).blocked_reason, 'dispatch_failed');
    await blockRunQueueEntry(db, entry.id, NOW, { reason: 'no_agent' });
    assert.equal((await row()).blocked_reason, 'no_agent');
  });

  it('hold and block never touch an in-flight entry', async () => {
    const { db, entry, row, set } = await queuedObjective();
    for (const state of ['dispatched', 'running']) {
      await set('state = ?', [state]);
      const before = await row();
      await holdRunQueueEntry(db, entry.id, NOW, { reason: 'mission_busy' });
      await blockRunQueueEntry(db, entry.id, NOW, { reason: 'no_agent' });
      await markRunQueueEntryDispatched(db, entry.id, NOW, { executionRequestId: 'x' });
      assert.deepEqual(await row(), before, `${state} is left alone`);
    }
  });

  it('mark running clears every hold without spending an attempt', async () => {
    const { db, entry, objectives, row, set } = await queuedObjective();
    await set(
      "state = 'blocked', blocked_reason = 'no_agent', waiting_reason = 'mission_busy', waiting_on_objective_id = ?, attempt_count = 1",
      [objectives[1]!.id]
    );
    await markRunQueueEntryRunning(db, entry.id, NOW);
    const running = await row();
    assert.equal(running.state, 'running');
    assert.equal(running.blocked_reason, null);
    assert.equal(running.waiting_reason, null);
    assert.equal(running.waiting_on_objective_id, null);
    assert.equal(running.attempt_count, 1);
  });

  it('dispatched links the request and spends one attempt', async () => {
    const { db, entry, row, set, insertRequest } = await queuedObjective();
    await set(
      "waiting_reason = 'retry_pending', blocked_reason = 'dispatch_failed', attempt_count = 1"
    );
    const requestId = await insertRequest('queued');
    await markRunQueueEntryDispatched(db, entry.id, NOW, { executionRequestId: requestId });
    const dispatched = await row();
    assert.equal(dispatched.state, 'dispatched');
    assert.equal(dispatched.execution_request_id, requestId);
    assert.equal(dispatched.dispatched_at, NOW);
    assert.equal(dispatched.attempt_count, 2);
    assert.equal(dispatched.blocked_reason, null);
    assert.equal(dispatched.waiting_reason, null);
  });

  it('a dispatch failure waits as retry_pending with a bounded cause', async () => {
    const { db, entry, row } = await queuedObjective();
    await recordRunQueueDispatchFailure(db, entry.id, NOW, { detail: 'x'.repeat(1000) });
    const failed = await row();
    assert.equal(failed.state, 'waiting');
    assert.equal(failed.waiting_reason, 'retry_pending');
    assert.equal(failed.blocked_reason, `dispatch_failed: ${'x'.repeat(400)}`);
    assert.equal(failed.attempt_count, 1);
    assert.equal(failed.execution_request_id, null);

    await recordRunQueueDispatchFailure(db, entry.id, NOW, { detail: null });
    assert.equal((await row()).blocked_reason, 'dispatch_failed');
    assert.equal((await row()).attempt_count, 2);
  });

  it('retry and move go through the same hold', async () => {
    const { db, entry, row, set } = await queuedObjective();
    await set("state = 'blocked', blocked_reason = 'dispatch_failed: boom', attempt_count = 3");
    await retryRunQueueEntry(db, entry.id);
    const retried = await row();
    assert.equal(retried.state, 'waiting');
    assert.equal(retried.waiting_reason, 'retry_pending');
    assert.equal(retried.blocked_reason, null);
    assert.equal(retried.attempt_count, 0);

    await set("state = 'blocked', blocked_reason = 'no_agent'");
    await moveRunQueueEntry(db, entry.id, {});
    const moved = await row();
    assert.equal(moved.state, 'waiting');
    assert.equal(moved.waiting_reason, null);
    assert.equal(moved.blocked_reason, null);
  });
});

describe('wedged launching objective reset', () => {
  it('resets only a launching objective with no active execution request', async () => {
    const { db, objectives, insertRequest, objectiveState } = await queuedObjective();
    const objectiveId = objectives[0]!.id;
    await db.run("UPDATE objectives SET state = 'launching' WHERE id = ?", [objectiveId]);
    const requestId = await insertRequest('claimed');
    assert.equal(await resetWedgedLaunchingObjective(db, objectiveId, NOW), false);
    assert.equal(await objectiveState(), 'launching');

    await db.run("UPDATE execution_requests SET status = 'expired' WHERE id = ?", [requestId]);
    assert.equal(await resetWedgedLaunchingObjective(db, objectiveId, NOW), true);
    assert.equal(await objectiveState(), 'draft');
    assert.equal(await resetWedgedLaunchingObjective(db, objectiveId, NOW), false);
  });

  it('a forced removal honors the guard unless the caller clears the requests first', async () => {
    const guarded = await queuedObjective();
    await guarded.set("state = 'dispatched'");
    await guarded.db.run("UPDATE objectives SET state = 'launching' WHERE id = ?", [
      guarded.objectives[0]!.id
    ]);
    await guarded.insertRequest('queued');
    const kept = await removeRunQueueEntry(guarded.db, guarded.entry.id, { force: true });
    assert.equal(kept.objectiveReset, false, 'an active request means the launch is not wedged');
    assert.equal(kept.clearedExecutionRequests, 0);
    assert.equal(await guarded.objectiveState(), 'launching');

    const cleared = await queuedObjective();
    await cleared.set("state = 'dispatched'");
    await cleared.db.run("UPDATE objectives SET state = 'launching' WHERE id = ?", [
      cleared.objectives[0]!.id
    ]);
    await cleared.insertRequest('queued');
    const removal = await removeRunQueueEntry(cleared.db, cleared.entry.id, {
      force: true,
      clearActiveRequests: async (tx, { objectiveId }) =>
        (
          await tx.run(
            "UPDATE execution_requests SET status = 'cleared' WHERE objective_id = ? AND status = 'queued'",
            [objectiveId]
          )
        ).changes
    });
    assert.equal(removal.clearedExecutionRequests, 1);
    assert.equal(removal.objectiveReset, true);
    assert.equal(await cleared.objectiveState(), 'draft');
  });

  it('an unforced removal never runs the clearing step', async () => {
    const { db, entry } = await queuedObjective();
    let called = false;
    const removal = await removeRunQueueEntry(db, entry.id, {
      clearActiveRequests: async () => {
        called = true;
        return 0;
      }
    });
    assert.equal(called, false);
    assert.equal(removal.clearedExecutionRequests, 0);
  });
});
