import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-completed-window-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'window.sqlite') });

const { db } = await import('./db.ts');
const {
  COMPLETED_MISSION_WINDOW_DAYS,
  createProject,
  createMission,
  listMissions,
  listProjectStatuses,
  listWorkspaceMyMissions,
  updateMission
} = await import('./repository.ts');

async function statusFor(projectId: string, key: string) {
  const status = (await listProjectStatuses(projectId)).find(item => item.key === key);
  assert.ok(status, `expected ${key} status for project ${projectId}`);
  return status;
}

/**
 * Backdate a mission's last-touch timestamp. The window is cut on `updated_at`
 * because the schema carries no completion timestamp, so this is the only lever
 * a test has over which side of the cutoff a mission falls on.
 */
function backdate(missionId: string, days: number) {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE missions SET updated_at = ? WHERE id = ?`).run(at, missionId);
}

const wellOutside = COMPLETED_MISSION_WINDOW_DAYS + 5;
const wellInside = COMPLETED_MISSION_WINDOW_DAYS - 5;

test('the project board windows completed and cancelled missions by default', async () => {
  const project = await createProject({ name: 'Window Board' });
  const done = await statusFor(project.id, 'done');
  const cancelled = await statusFor(project.id, 'cancelled');
  const inProgress = await statusFor(project.id, 'in_progress');

  const recentlyDone = await createMission({ projectId: project.id, firstObjective: 'recent' });
  const longDone = await createMission({ projectId: project.id, firstObjective: 'archived' });
  const longCancelled = await createMission({ projectId: project.id, firstObjective: 'dropped' });
  const staleExecuting = await createMission({ projectId: project.id, firstObjective: 'stalled' });

  await updateMission(recentlyDone.id, { statusId: done.id });
  await updateMission(longDone.id, { statusId: done.id });
  await updateMission(longCancelled.id, { statusId: cancelled.id });
  await updateMission(staleExecuting.id, { statusId: inProgress.id });

  backdate(recentlyDone.id, wellInside);
  backdate(longDone.id, wellOutside);
  backdate(longCancelled.id, wellOutside);
  backdate(staleExecuting.id, wellOutside);

  const windowed = (await listMissions(project.id)).map(mission => mission.id);
  assert.ok(windowed.includes(recentlyDone.id), 'a recently finished mission stays on the board');
  assert.ok(!windowed.includes(longDone.id), 'an old completed mission is dropped');
  assert.ok(!windowed.includes(longCancelled.id), 'an old cancelled mission is dropped');
  assert.ok(
    windowed.includes(staleExecuting.id),
    'a non-terminal mission is never windowed, however old'
  );

  const expanded = (await listMissions(project.id, { includeAllCompleted: true })).map(
    mission => mission.id
  );
  assert.ok(expanded.includes(longDone.id), 'includeAllCompleted restores the archive');
  assert.ok(expanded.includes(longCancelled.id));
  assert.ok(expanded.includes(recentlyDone.id));
  assert.ok(expanded.includes(staleExecuting.id));
});

test('My Missions applies the same window and honours includeAllCompleted', async () => {
  const project = await createProject({ name: 'Window My Missions' });
  const done = await statusFor(project.id, 'done');
  const inReview = await statusFor(project.id, 'in_review');

  const recentlyDone = await createMission({ projectId: project.id, firstObjective: 'mm recent' });
  const longDone = await createMission({ projectId: project.id, firstObjective: 'mm archived' });
  const staleReview = await createMission({ projectId: project.id, firstObjective: 'mm review' });

  await updateMission(recentlyDone.id, { statusId: done.id });
  await updateMission(longDone.id, { statusId: done.id });
  await updateMission(staleReview.id, { statusId: inReview.id });

  backdate(recentlyDone.id, wellInside);
  backdate(longDone.id, wellOutside);
  backdate(staleReview.id, wellOutside);

  const windowed = (await listWorkspaceMyMissions()).missions.map(mission => mission.id);
  assert.ok(windowed.includes(recentlyDone.id));
  assert.ok(!windowed.includes(longDone.id), 'an old completed mission is dropped');
  assert.ok(windowed.includes(staleReview.id), 'a review-type mission is never windowed');

  const expanded = (await listWorkspaceMyMissions({ includeAllCompleted: true })).missions.map(
    mission => mission.id
  );
  assert.ok(expanded.includes(longDone.id), 'includeAllCompleted restores the archive');
  assert.ok(expanded.includes(recentlyDone.id));
  assert.ok(expanded.includes(staleReview.id));
});
