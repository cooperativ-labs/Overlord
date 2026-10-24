import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listObjectiveFileChanges } from './changes.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import {
  attachSession,
  deliverSession,
  recordWork,
  syncChanges,
  updateSession
} from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

async function setup() {
  const seeded = await createSeededServiceContext();
  const project = await createProject({ ctx: seeded.ctx, name: 'Changed files' });
  async function mission(objectives = 1) {
    const created = await createMissionWithObjectives({
      ctx: seeded.ctx,
      projectId: project.id,
      objectives: Array.from({ length: objectives }, (_, index) => ({
        objective: `Objective ${index}`
      }))
    });
    return created;
  }
  async function attach(
    missionId: string,
    objectiveId: string,
    captureBindingState?: 'bound' | 'unbound' | 'unknown'
  ) {
    await seeded.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectiveId]);
    return attachSession({
      ctx: seeded.ctx,
      missionId,
      objectiveId,
      agentIdentifier: 'test-agent',
      ...(captureBindingState ? { captureBindingState } : {})
    });
  }
  return { ...seeded, project, mission, attach };
}

describe('compact changed-file evidence', () => {
  it('recovers late evidence after delivery without reopening or rewriting delivery', async () => {
    const { db, ctx, mission, attach } = await setup();
    try {
      const { mission: m, objectives } = await mission();
      const session = await attach(m.id, objectives[0]!.id, 'bound');
      await deliverSession({
        ctx,
        missionId: m.id,
        sessionKey: session.sessionKey,
        summary: 'Done.'
      });
      const deliveryBefore = await db.get('SELECT * FROM deliveries WHERE mission_id = ?', [m.id]);
      const stateBefore = await db.get('SELECT state FROM objectives WHERE id = ?', [
        objectives[0]!.id
      ]);
      const input = {
        ctx,
        missionId: m.id,
        sessionKey: session.sessionKey,
        changes: [{ filePath: 'late.ts', idempotencyKey: 'late-1', source: 'declared_edit' }],
        capture: { health: [{ code: 'shell_activity_unverified', at: '2026-10-01T00:00:00Z' }] }
      };
      assert.equal((await syncChanges(input)).outcomes[0]?.status, 'accepted');
      assert.equal((await syncChanges(input)).outcomes[0]?.status, 'ignored');
      const read = await listObjectiveFileChanges({
        ctx,
        missionId: m.id,
        objectiveId: objectives[0]!.id
      });
      assert.equal(read.total, 1);
      assert.ok(read.capture.warnings.includes('tool_activity_uncaptured'));
      assert.deepEqual(
        await db.get('SELECT * FROM deliveries WHERE mission_id = ?', [m.id]),
        deliveryBefore
      );
      assert.deepEqual(
        await db.get('SELECT state FROM objectives WHERE id = ?', [objectives[0]!.id]),
        stateBefore
      );
      await assert.rejects(
        updateSession({
          ctx,
          missionId: m.id,
          sessionKey: session.sessionKey,
          summary: 'Must remain closed'
        }),
        /Invalid or expired/
      );
      const other = await mission();
      await assert.rejects(
        syncChanges({ ...input, missionId: other.mission.id }),
        /does not match mission/
      );
      await db.run("UPDATE agent_sessions SET delivery_state = 'not_delivered' WHERE id = ?", [
        session.session.id
      ]);
      await assert.rejects(syncChanges(input), /Invalid or expired/);
      await db.run(
        "UPDATE agent_sessions SET delivery_state = 'delivered', deleted_at = ? WHERE id = ?",
        [new Date().toISOString(), session.session.id]
      );
      await assert.rejects(syncChanges(input), /Invalid or expired/);
    } finally {
      await db.close();
    }
  });

  it('keeps native provenance over later declarations and upgrades declared rows', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const session = await attach(m.id, objectives[0]!.id);
    const sync = (
      path: string,
      key: string,
      source: 'declared_edit' | 'agent_declared',
      extra = {}
    ) =>
      syncChanges({
        ctx,
        missionId: m.id,
        sessionKey: session.sessionKey,
        changes: [{ filePath: path, idempotencyKey: key, source, ...extra }]
      });

    await sync('a.ts', 'k1', 'declared_edit', { hookHealth: 'direct_path_observed' });
    await sync('a.ts', 'k2', 'agent_declared', { hookHealth: 'agent_declared' });
    await sync('b.ts', 'k3', 'agent_declared', { hookHealth: 'agent_declared' });
    await sync('b.ts', 'k4', 'declared_edit', { hookHealth: 'direct_path_observed' });

    const read = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id
    });
    const byPath = Object.fromEntries(read.items.map(item => [item.filePath, item]));
    assert.equal(byPath['a.ts']?.source, 'declared_edit');
    assert.equal(byPath['a.ts']?.hookHealth, 'direct_path_observed');
    assert.equal(byPath['b.ts']?.source, 'declared_edit');
    assert.equal(read.scope, 'server_objective');
    assert.equal(read.total, 2);
    assert.equal(read.truncated, false);
    assert.deepEqual(Object.keys(read.items[0]!).sort(), [
      'filePath',
      'hookHealth',
      'id',
      'missionId',
      'objectiveId',
      'observedAt',
      'resourceKey',
      'source'
    ]);
    await db.close();
  });

  it('retains the earliest first observation and never regresses the last one', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const session = await attach(m.id, objectives[0]!.id);
    const sync = (key: string, observedAt: string) =>
      syncChanges({
        ctx,
        missionId: m.id,
        sessionKey: session.sessionKey,
        changes: [{ filePath: 'late.ts', idempotencyKey: key, source: 'declared_edit', observedAt }]
      });
    await sync('k1', '2026-10-02T00:00:00Z');
    await sync('k2', '2026-10-01T00:00:00Z');
    const row = (await db.get(
      `SELECT first_observed_at, last_observed_at FROM changed_files WHERE file_path = 'late.ts'`
    )) as { first_observed_at: string; last_observed_at: string };
    assert.equal(row.first_observed_at, '2026-10-01T00:00:00.000Z');
    assert.equal(row.last_observed_at, '2026-10-02T00:00:00.000Z');
    await db.close();
  });

  it('rejects retired fields and window sources clearly', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const session = await attach(m.id, objectives[0]!.id);
    const result = await syncChanges({
      ctx,
      missionId: m.id,
      sessionKey: session.sessionKey,
      changes: [
        { filePath: 'x.ts', idempotencyKey: 'q', source: 'declared_edit', quality: 'direct' },
        { filePath: 'y.ts', idempotencyKey: 'w', source: 'window_observed' }
      ]
    });
    assert.deepEqual(
      result.outcomes.map(outcome => outcome.status),
      ['warning', 'warning']
    );
    assert.match(result.outcomes[0]?.warning ?? '', /retired/);
    assert.match(result.outcomes[1]?.warning ?? '', /declared_edit or agent_declared/);
    await db.close();
  });

  it('applies the objective filter before count and cap, and rejects foreign objectives', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission(2);
    const busy = await attach(m.id, objectives[0]!.id);
    const quiet = await attach(m.id, objectives[1]!.id);
    for (let batch = 0; batch < 9; batch += 1) {
      await syncChanges({
        ctx,
        missionId: m.id,
        sessionKey: busy.sessionKey,
        changes: Array.from({ length: 25 }, (_, index) => ({
          filePath: `busy/${batch}-${index}.ts`,
          idempotencyKey: `busy-${batch}-${index}`,
          source: 'declared_edit'
        }))
      });
    }
    await syncChanges({
      ctx,
      missionId: m.id,
      sessionKey: quiet.sessionKey,
      changes: [{ filePath: 'busy/0-0.ts', idempotencyKey: 'q1', source: 'declared_edit' }]
    });

    const busyRead = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id
    });
    assert.equal(busyRead.items.length, 200);
    assert.equal(busyRead.total, 225);
    assert.equal(busyRead.truncated, true);
    const quietRead = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[1]!.id
    });
    // The same physical path is associated with both objectives independently.
    assert.deepEqual(
      quietRead.items.map(item => item.filePath),
      ['busy/0-0.ts']
    );
    assert.equal(quietRead.total, 1);

    const other = await mission();
    await assert.rejects(
      listObjectiveFileChanges({
        ctx,
        missionId: m.id,
        objectiveId: other.objectives[0]!.id
      }),
      /does not belong/i
    );
    await db.close();
  });

  it('records sessionless declarations as agent_declared with a null resource', async () => {
    const { db, ctx, project } = await setup();
    const { mission } = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Finished in chat',
      summary: 'Did the thing.',
      declaredPaths: ['src/a.ts', 'src/a.ts', 'dir/with,comma.ts', '../escape.ts', '/abs.ts']
    });
    const rows = (await db.all(
      `SELECT file_path, source, session_id, resource_id FROM changed_files
        WHERE mission_id = ? ORDER BY file_path`,
      [mission.id]
    )) as Array<{
      file_path: string;
      source: string | null;
      session_id: string | null;
      resource_id: string | null;
    }>;
    assert.deepEqual(
      rows.map(row => [row.file_path, row.source, row.session_id, row.resource_id]),
      [
        ['dir/with,comma.ts', 'agent_declared', null, null],
        ['src/a.ts', 'agent_declared', null, null]
      ]
    );
    await db.close();
  });

  it('accepts declared paths on update and deliver without gating delivery', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const session = await attach(m.id, objectives[0]!.id);
    await updateSession({
      ctx,
      missionId: m.id,
      sessionKey: session.sessionKey,
      summary: 'Ran a generator.',
      declaredPaths: ['gen/out.ts', 'gone/deleted.ts', '../bad.ts']
    });
    await deliverSession({
      ctx,
      missionId: m.id,
      sessionKey: session.sessionKey,
      summary: 'Done.',
      declaredPaths: ['gen/out2.ts']
    });
    const read = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id
    });
    assert.deepEqual(
      read.items.map(item => [item.filePath, item.source]),
      [
        ['gen/out.ts', 'agent_declared'],
        ['gen/out2.ts', 'agent_declared'],
        ['gone/deleted.ts', 'agent_declared']
      ]
    );
    const payload = (await db.get(`SELECT payload_json FROM deliveries WHERE mission_id = ?`, [
      m.id
    ])) as { payload_json: string };
    assert.ok(payload.payload_json.includes('"deliveryReport"'));
    await db.close();
  });
});

describe('session capture diagnostics', () => {
  it('records binding at attach and warns honestly across sessions', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const first = await attach(m.id, objectives[0]!.id, 'unbound');
    const read = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id
    });
    assert.equal(read.items.length, 0);
    assert.equal(read.capture.sessions[0]?.bindingState, 'unbound');
    assert.deepEqual(read.capture.warnings, ['unbound']);

    const bound = await attachSession({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id,
      agentIdentifier: 'second',
      existingSessionKey: first.sessionKey,
      captureBindingState: 'bound'
    });
    assert.equal(bound.session.id, first.session.id);
    const after = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id
    });
    assert.equal(after.capture.sessions[0]?.bindingState, 'bound');
    assert.deepEqual(after.capture.warnings, ['bound_no_callback']);
    await db.close();
  });

  it('aggregates sticky gaps idempotently and bounds distinct codes', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const session = await attach(m.id, objectives[0]!.id, 'bound');
    const diag = (capture: unknown) =>
      syncChanges({ ctx, missionId: m.id, sessionKey: session.sessionKey, changes: [], capture });

    const first = await diag({
      callbackObservedAt: '2026-10-02T00:00:00Z',
      health: [{ code: 'direct_path_unavailable', at: '2026-10-02T00:00:00Z' }]
    });
    assert.equal(first.capture?.status, 'accepted');
    const replay = await diag({
      callbackObservedAt: '2026-10-02T00:00:00Z',
      health: [{ code: 'direct_path_unavailable', at: '2026-10-02T00:00:00Z' }]
    });
    assert.equal(replay.capture?.status, 'ignored');
    await diag({ callbackObservedAt: '2026-10-01T00:00:00Z', health: [] });
    for (let index = 0; index < 20; index += 1) {
      await diag({
        health: [
          { code: `noise_${index}`, at: `2026-10-03T00:00:${String(index).padStart(2, '0')}Z` }
        ]
      });
    }
    const bad = await diag({ bindingState: 'sure' });
    assert.equal(bad.capture?.status, 'warning');
    const unsupported = await diag({ rawPayload: 'secret' });
    assert.equal(unsupported.capture?.status, 'warning');

    const read = await listObjectiveFileChanges({
      ctx,
      missionId: m.id,
      objectiveId: objectives[0]!.id
    });
    const stored = read.capture.sessions[0]!;
    assert.equal(stored.callbackObservedAt, '2026-10-01T00:00:00.000Z');
    assert.ok(stored.health.length <= 16);
    assert.ok(stored.health.some(entry => entry.code === 'direct_path_unavailable'));
    assert.deepEqual(read.capture.warnings, ['tool_activity_uncaptured']);
    await db.close();
  });

  it('emits a session refresh and rejects a session key for another mission', async () => {
    const { db, ctx, mission, attach } = await setup();
    const { mission: m, objectives } = await mission();
    const session = await attach(m.id, objectives[0]!.id);
    const before = (await db.get(`SELECT COALESCE(MAX(seq), 0) AS seq FROM entity_changes`)) as {
      seq: number;
    };
    await syncChanges({
      ctx,
      missionId: m.id,
      sessionKey: session.sessionKey,
      changes: [],
      capture: { bindingState: 'bound' }
    });
    const changes = (await db.all(`SELECT entity_type FROM entity_changes WHERE seq > ?`, [
      before.seq
    ])) as Array<{ entity_type: string }>;
    assert.deepEqual(
      changes.map(change => change.entity_type),
      ['agent_session']
    );

    const other = await mission();
    await assert.rejects(
      syncChanges({
        ctx,
        missionId: other.mission.id,
        sessionKey: session.sessionKey,
        changes: [],
        capture: { bindingState: 'bound' }
      }),
      /does not match mission/
    );
    await db.close();
  });
});
