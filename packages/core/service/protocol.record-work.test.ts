import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listObjectiveFileChanges } from './changes.js';
import { ServiceError } from './errors.js';
import { createProject } from './projects.js';
import { recordWork } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';
import { DELIVERY_COMPOSE_JOB_TYPE } from './worker-jobs.js';

async function setup() {
  return createSeededServiceContext({ source: 'cli' });
}

describe('recordWork (record completed chat work as a review mission)', () => {
  it('requires an explicit project instead of discovering one', async () => {
    const { db, ctx } = await setup();

    await assert.rejects(
      recordWork({
        ctx,
        objective: 'Do not infer a destination project.',
        summary: 'This submission needs explicit routing.'
      }),
      /explicit project ID/
    );

    await db.close();
  });

  it('creates a review mission with one completed objective and a delivery', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Basic' });

    const { mission, deliveryId } = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Build the widget the user asked for.',
      summary: 'Added the widget and wired it up.',
      declaredPaths: ['src/widget.ts']
    });

    const missionRow = (await db.get(`SELECT status_type FROM missions WHERE id = ?`, [
      mission.id
    ])) as { status_type: string } | undefined;
    assert.equal(missionRow?.status_type, 'review');

    const objectiveRow = (await db.get(`SELECT state FROM objectives WHERE mission_id = ?`, [
      mission.id
    ])) as { state: string } | undefined;
    assert.ok(objectiveRow, 'objective exists');

    const delivery = (await db.get(`SELECT id, session_id FROM deliveries WHERE id = ?`, [
      deliveryId
    ])) as { id: string; session_id: string | null } | undefined;
    assert.ok(delivery, 'delivery row exists');
    assert.equal(delivery?.session_id, null, 'record-work delivery has no session');

    await db.close();
  });

  it('stores explicit paths as sessionless agent declarations and drops unsafe ones', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Coverage' });

    const { mission, deliveryId } = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Ship the feature.',
      summary: 'Shipped it.',
      declaredPaths: [
        'src/a.ts',
        null,
        '/private/host-path.ts',
        '.overlord/tmp/scratch.txt',
        'src/b.ts'
      ]
    });

    const objectiveId = (
      (await db.get(`SELECT id FROM objectives WHERE mission_id = ?`, [mission.id])) as {
        id: string;
      }
    ).id;
    const files = await listObjectiveFileChanges({ ctx, missionId: mission.id, objectiveId });
    const byPath = new Map(files.items.map(file => [file.filePath, file]));

    assert.deepEqual([...byPath.keys()].sort(), ['src/a.ts', 'src/b.ts']);
    assert.equal(byPath.get('src/a.ts')?.source, 'agent_declared');
    assert.equal(byPath.get('src/a.ts')?.resourceKey, null);
    assert.deepEqual(files.capture.sessions, []);
    const reviewChanges = (await db.all(
      `SELECT entity_type, operation FROM entity_changes
        WHERE mission_id = ? AND entity_type = 'changed_file' ORDER BY seq`,
      [mission.id]
    )) as Array<{ entity_type: string; operation: string }>;
    assert.deepEqual(reviewChanges, [
      { entity_type: 'changed_file', operation: 'insert' },
      { entity_type: 'changed_file', operation: 'insert' }
    ]);
    const delivery = (await db.get(`SELECT payload_json FROM deliveries WHERE id = ?`, [
      deliveryId
    ])) as { payload_json: string };
    const warnings = JSON.parse(delivery.payload_json).deliveryReport.warnings as string[];
    assert.equal(warnings.length, 3);

    await db.close();
  });

  it('enqueues the Gemini delivery compose job in the same transaction', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Compose' });

    const { deliveryId } = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Do the thing.',
      summary: 'Did the thing.'
    });

    const job = (await db.get(
      `SELECT status FROM worker_jobs
         WHERE type = ? AND json_extract(payload_json, '$.deliveryId') = ?`,
      [DELIVERY_COMPOSE_JOB_TYPE, deliveryId]
    )) as { status: string } | undefined;
    assert.ok(job, 'a compose job was enqueued for the record-work delivery');
    assert.equal(job?.status, 'queued');

    await db.close();
  });

  it('rejects an invalid artifact type with a clean validation error', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Invalid Artifact' });

    await assert.rejects(
      () =>
        recordWork({
          ctx,
          projectId: project.id,
          objective: 'Record with a bad artifact.',
          summary: 'Tried to record it.',
          artifacts: [{ type: 'not_a_real_type', label: 'Bad', content: 'nope' }]
        }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 400 &&
        error.code === 'validation_error' &&
        error.message.includes('Artifact type must be')
    );

    await db.close();
  });

  it('rejects malformed artifact items before creating record-work state', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Malformed Artifact' });
    const before = (await db.get(`SELECT COUNT(*) AS count FROM missions`)) as { count: number };

    await assert.rejects(
      () =>
        recordWork({
          ctx,
          projectId: project.id,
          objective: 'Record malformed evidence.',
          summary: 'Malformed artifact must not create a mission.',
          artifacts: [null]
        }),
      (error: unknown) =>
        error instanceof ServiceError && error.status === 400 && error.code === 'validation_error'
    );

    const after = (await db.get(`SELECT COUNT(*) AS count FROM missions`)) as { count: number };
    assert.equal(after.count, before.count);
    await db.close();
  });

  it('inserts a valid artifact through the shared writer', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Valid Artifact' });

    const { mission } = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Record with a note.',
      summary: 'Recorded it.',
      artifacts: [{ type: 'next_steps', label: 'Follow-up', content: 'Ship the docs.' }]
    });

    const row = (await db.get(
      `SELECT type, label, content_text FROM artifacts WHERE mission_id = ?`,
      [mission.id]
    )) as { type: string; label: string; content_text: string | null };
    assert.equal(row.type, 'next_steps');
    assert.equal(row.label, 'Follow-up');
    assert.equal(row.content_text, 'Ship the docs.');

    await db.close();
  });
});
