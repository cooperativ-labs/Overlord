import { createIsolatedCheckout } from '@overlord/core/service/test-checkout';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webapp-launch-'));
process.env.OVERLORD_SQLITE_PATH = path.join(tempDir, 'webapp.sqlite');

const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const {
  createProject,
  createProjectResource,
  createMission,
  createObjective,
  getMissionDetail,
  updateMission,
  updateObjective
} = await import('./repository.ts');
const { launchObjective, getAgentCatalog, updateAgentCatalog } =
  await import('./execution/launch.ts');

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test('launching an objective twice while a request is active returns the same request', async () => {
  const project = await createProject({ name: 'Idempotent Launch Test' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-resource-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Do the thing'
  });
  const objectiveId = mission.objectives[0]!.id;

  const first = await launchObjective(objectiveId, { agent: 'codex' });
  const second = await launchObjective(objectiveId, { agent: 'codex' });

  assert.equal(second.id, first.id);
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM execution_requests WHERE objective_id = ?`)
    .get(objectiveId) as { n: number };
  assert.equal(count.n, 1);

  await updateObjective(objectiveId, { state: 'complete' });

  const cleared = db
    .prepare(`SELECT status FROM execution_requests WHERE id = ?`)
    .get(first.id) as { status: string };
  assert.equal(cleared.status, 'cleared');

  const manualEvent = db
    .prepare(
      `SELECT summary, payload_json FROM mission_events
        WHERE objective_id = ? AND type = 'status_change'
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(objectiveId) as { summary: string; payload_json: string };
  assert.equal(
    manualEvent.summary,
    'Objective completed: cleared 1 delegated execution request(s) and ended 0 active session(s).'
  );
  assert.equal(JSON.parse(manualEvent.payload_json).clearedRequests, 1);

  const serviceClearEvents = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mission_events
        WHERE objective_id = ? AND summary = 'Cleared execution request.'`
    )
    .get(objectiveId) as { n: number };
  assert.equal(serviceClearEvents.n, 0);
});

test('mission detail projects Latch terminal sessions independently of active requests', async () => {
  const project = await createProject({ name: 'Terminal Session Projection' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-terminal-session-resource-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Keep the shell after delivery'
  });
  const request = await launchObjective(mission.objectives[0]!.id, { agent: 'codex' });
  db.prepare(
    `UPDATE execution_requests
        SET status = 'launched', metadata_json = ?
      WHERE id = ?`
  ).run(
    JSON.stringify({
      launchSession: {
        version: 1,
        executionProvider: { kind: 'latch', executable: '/opt/latch' },
        viewer: { kind: 'iterm', openOnLaunch: true },
        resolvedAt: '2026-08-12T15:00:00.000Z'
      },
      providerSession: {
        provider: 'latch',
        providerSessionId: 'ses_projection',
        sessionName: 'keep-the-shell',
        executionTargetId: null,
        agentSessionId: null,
        createdAt: '2026-08-12T15:00:00.000Z',
        lastObservedState: 'running'
      }
    }),
    request.id
  );

  const detail = await getMissionDetail(mission.id);
  assert.equal(detail.executionRequests.length, 0);
  assert.deepEqual(detail.terminalSessions, [
    {
      executionRequestId: request.id,
      objectiveId: mission.objectives[0]!.id,
      provider: 'latch',
      providerSessionId: 'ses_projection',
      sessionName: 'keep-the-shell',
      executionTargetId: null,
      deviceLabel: null,
      agentSessionId: null,
      executable: '/opt/latch',
      viewerKind: 'iterm',
      // This snapshot predates `openAs`, and a run that froze no shape opened a
      // window — so the projection must say `window`, never guess `tab`.
      viewerOpenAs: 'window',
      createdAt: '2026-08-12T15:00:00.000Z',
      lastObservedState: 'running'
    }
  ]);
});

test('parking an active objective to submitted clears its queue and allows launching a sibling', async () => {
  const project = await createProject({ name: 'Disconnect Park Launch Test' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-park-resource-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'First objective'
  });
  const firstObjectiveId = mission.objectives[0]!.id;
  const firstRequest = await launchObjective(firstObjectiveId, { agent: 'codex' });

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Second objective'
  });

  await assert.rejects(() => launchObjective(second.id, { agent: 'codex' }), /Enable auto-advance/);

  const parked = await updateObjective(firstObjectiveId, { state: 'submitted' });
  assert.equal(parked.state, 'submitted');

  const cleared = db
    .prepare(`SELECT status FROM execution_requests WHERE id = ?`)
    .get(firstRequest.id) as { status: string };
  assert.equal(cleared.status, 'cleared');

  const secondRequest = await launchObjective(second.id, { agent: 'codex' });
  assert.equal(secondRequest.objectiveId, second.id);
});

test('launching ignores stale active requests tied to completed objectives', async () => {
  const project = await createProject({ name: 'Stale Completed Request Launch Test' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-stale-resource-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Completed objective'
  });
  const completedObjectiveId = mission.objectives[0]!.id;
  await updateObjective(completedObjectiveId, { state: 'complete' });

  const now = new Date().toISOString();
  const staleRequestId = crypto.randomUUID();
  const missionRow = db
    .prepare(`SELECT workspace_id, project_id FROM missions WHERE id = ?`)
    .get(mission.id) as { workspace_id: string; project_id: string };
  db.prepare(
    `INSERT INTO execution_requests
       (id, workspace_id, project_id, mission_id, objective_id, requested_agent, launch_mode,
        launch_flags_json, requested_source, status, metadata_json, created_at,
        updated_at, revision)
     VALUES (?, ?, ?, ?, ?, 'codex', 'run', '{}', 'webapp', 'queued', '{}', ?, ?, 1)`
  ).run(
    staleRequestId,
    missionRow.workspace_id,
    missionRow.project_id,
    mission.id,
    completedObjectiveId,
    now,
    now
  );

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Next objective'
  });

  const request = await launchObjective(second.id, { agent: 'codex' });
  assert.equal(request.objectiveId, second.id);
});

test('launching another objective while one is active is rejected without queueing', async () => {
  const project = await createProject({ name: 'Busy Mission Launch Test' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-busy-resource-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'First objective'
  });
  const firstObjectiveId = mission.objectives[0]!.id;
  await launchObjective(firstObjectiveId, { agent: 'codex' });

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Second objective'
  });

  await assert.rejects(() => launchObjective(second.id, { agent: 'codex' }), /Enable auto-advance/);

  const secondRequestCount = db
    .prepare(`SELECT COUNT(*) AS n FROM execution_requests WHERE objective_id = ?`)
    .get(second.id) as { n: number };
  assert.equal(secondRequestCount.n, 0);

  const secondObjective = db
    .prepare(`SELECT auto_advance FROM objectives WHERE id = ?`)
    .get(second.id) as { auto_advance: number };
  assert.equal(secondObjective.auto_advance, 0);
});

test('updateAgentCatalog persists model order and display names', async () => {
  const initial = await getAgentCatalog();
  const cursor = initial.agents.find(agent => agent.key === 'cursor');
  assert.ok(cursor);
  assert.ok(cursor.models.length >= 2);

  const reversed = [...cursor.models].reverse();
  const updated = await updateAgentCatalog({
    agents: initial.agents.map(agent =>
      agent.key === 'cursor'
        ? {
            ...agent,
            models: reversed.map((model, index) => ({
              ...model,
              displayName: index === 0 ? 'Top Model' : model.displayName
            }))
          }
        : agent
    )
  });

  const savedCursor = updated.agents.find(agent => agent.key === 'cursor');
  assert.ok(savedCursor);
  assert.equal(savedCursor.models[0]?.displayName, 'Top Model');
  assert.equal(
    savedCursor.models.map(model => model.id).join(','),
    reversed.map(model => model.id).join(',')
  );

  const row = db
    .prepare(`SELECT settings_json FROM workspaces WHERE deleted_at IS NULL LIMIT 1`)
    .get() as { settings_json: string };
  const settings = JSON.parse(row.settings_json) as {
    agentCatalog?: { agents?: { cursor?: { models?: Array<{ displayName: string }> } } };
  };
  assert.equal(settings.agentCatalog?.agents?.cursor?.models?.[0]?.displayName, 'Top Model');
});

test('persists allowParallelObjectives on the mission', async () => {
  const project = await createProject({ name: 'Parallel Flag Round Trip' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-parallel-flag-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Serial by default'
  });
  assert.equal(mission.allowParallelObjectives, false);

  const enabled = await updateMission(mission.id, { allowParallelObjectives: true });
  assert.equal(enabled.allowParallelObjectives, true);
  assert.equal((await getMissionDetail(mission.id)).allowParallelObjectives, true);

  const disabled = await updateMission(mission.id, { allowParallelObjectives: false });
  assert.equal(disabled.allowParallelObjectives, false);
});

test('queues two objectives on different resources when parallel is opted in', async () => {
  const project = await createProject({ name: 'Parallel Different Resource Launch' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-parallel-primary-'),
    isPrimary: true
  });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-parallel-docs-'),
    resourceKey: 'docs',
    isPrimary: false
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Primary checkout work'
  });
  await updateMission(mission.id, { allowParallelObjectives: true });
  const first = await launchObjective(mission.objectives[0]!.id, { agent: 'codex' });

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Docs checkout work',
    resourceKey: 'docs'
  });
  const secondRequest = await launchObjective(second.id, { agent: 'codex' });

  assert.notEqual(secondRequest.id, first.id);
  assert.equal(secondRequest.objectiveId, second.id);
  const queued = db
    .prepare(
      `SELECT COUNT(*) AS n FROM execution_requests
        WHERE mission_id = ? AND status = 'queued' AND deleted_at IS NULL`
    )
    .get(mission.id) as { n: number };
  assert.equal(queued.n, 2);
});

test('queues a same-resource sibling launch when parallel is opted in', async () => {
  // Phase E: same-resource concurrency is allowed. The Runner Layer keeps the two
  // apart with a per-objective branch/worktree (worktree mode) or shares the
  // mission's single checkout deliberately (worktrees off) — the control plane no
  // longer serializes them.
  const project = await createProject({ name: 'Parallel Same Resource Launch' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-parallel-same-'),
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'First on primary'
  });
  await updateMission(mission.id, { allowParallelObjectives: true });
  const first = await launchObjective(mission.objectives[0]!.id, { agent: 'codex' });

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Also on primary'
  });
  const secondRequest = await launchObjective(second.id, { agent: 'codex' });

  assert.notEqual(secondRequest.id, first.id);
  assert.equal(secondRequest.objectiveId, second.id);
  const queued = db
    .prepare(
      `SELECT COUNT(*) AS n FROM execution_requests
        WHERE mission_id = ? AND status = 'queued' AND deleted_at IS NULL`
    )
    .get(mission.id) as { n: number };
  assert.equal(queued.n, 2);
});

test('still rejects a same-resource sibling launch while parallel is off', async () => {
  const project = await createProject({ name: 'Serial Same Resource Launch' });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-launch-serial-same-'),
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'First on primary'
  });
  await launchObjective(mission.objectives[0]!.id, { agent: 'codex' });

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Also on primary'
  });

  await assert.rejects(() => launchObjective(second.id, { agent: 'codex' }), /Enable auto-advance/);

  const secondRequestCount = db
    .prepare(`SELECT COUNT(*) AS n FROM execution_requests WHERE objective_id = ?`)
    .get(second.id) as { n: number };
  assert.equal(secondRequestCount.n, 0);
});

test('launchObjective stamps an explicit execution target and rejects an ineligible one', async () => {
  // Contract v41: `LaunchObjectiveBody.executionTargetId` is an explicit override.
  // The launch service validates it in the objective's workspace before stamping
  // `execution_requests.execution_target_id`; it selects a target only, so any
  // healthy runner serving that target may still claim the request.
  const project = await createProject({ name: 'Explicit Launch Target Test' });
  await createProjectResource(project.id, {
    // Omitted, not null: an omitted target on a local checkout is the
    // machine-local declaration (contract v39). An explicit null would write a
    // project-global source and declare nothing.
    directoryPath: createIsolatedCheckout('overlord-launch-override-'),
    isPrimary: true
  });
  const target = db
    .prepare(
      `SELECT id FROM execution_targets
        WHERE type = 'local' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { id: string } | undefined;
  assert.ok(target, 'linking a checkout declares the acting machine as a target');

  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Run this one on a chosen machine'
  });
  const objectiveId = mission.objectives[0]!.id;

  const request = await launchObjective(objectiveId, {
    agent: 'codex',
    executionTargetId: target.id
  });
  const stamped = db
    .prepare(`SELECT execution_target_id FROM execution_requests WHERE id = ?`)
    .get(request.id) as { execution_target_id: string | null };
  assert.equal(stamped.execution_target_id, target.id);

  // A target that does not exist in this workspace is never eligible.
  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Second objective'
  });
  await updateObjective(objectiveId, { state: 'complete' });
  await assert.rejects(
    () => launchObjective(second.id, { agent: 'codex', executionTargetId: crypto.randomUUID() }),
    /not active, reachable, or connected/
  );
});
