import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-inbox-missions-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { requireDatabaseClient } = await import('./db.ts');
const { createMission, createProject, listInboxMissions, listProjectStatuses, updateMission } =
  await import('./repository.ts');

async function statusFor(projectId: string, key: string) {
  const status = (await listProjectStatuses(projectId)).find(item => item.key === key);
  assert.ok(status, `expected ${key} status for project ${projectId}`);
  return status;
}

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('listInboxMissions includes recently created missions', async () => {
  const project = await createProject({ name: 'Inbox recent project' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Fresh human mission',
    statusId: next.id,
    firstObjective: 'Do the thing'
  });

  const response = await listInboxMissions();
  const found = response.missions.find(item => item.id === mission.id);
  assert.ok(found, 'expected recent mission in inbox list');
  assert.ok(found.reasons.includes('recent'));
  assert.equal(found.projectName, 'Inbox recent project');
});

test('listInboxMissions includes agent-created Next missions even when older', async () => {
  const project = await createProject({ name: 'Inbox agent project' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Agent filed next work',
    statusId: next.id,
    firstObjective: 'Agent follow-up'
  });

  // Stamp agent provenance after create — REST create is human by default.
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await requireDatabaseClient().run(
    `UPDATE missions
        SET created_by_kind = 'agent',
            created_by_agent = 'cursor',
            created_at = ?,
            updated_at = ?
      WHERE id = ?`,
    [eightDaysAgo, eightDaysAgo, mission.id]
  );

  const response = await listInboxMissions();
  const found = response.missions.find(item => item.id === mission.id);
  assert.ok(found, 'expected older agent Next mission in inbox list');
  assert.ok(found.reasons.includes('agent_next'));
  assert.equal(found.createdByKind, 'agent');
  assert.equal(found.createdByAgent, 'cursor');
  assert.equal(found.statusType, 'next');
});

test('listInboxMissions omits agent missions that left Next', async () => {
  const project = await createProject({ name: 'Inbox agent leave next' });
  const next = await statusFor(project.id, 'next_up');
  const execute = await statusFor(project.id, 'in_progress');
  const mission = await createMission({
    projectId: project.id,
    title: 'Agent mission now executing',
    statusId: next.id,
    firstObjective: 'Start work'
  });

  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await requireDatabaseClient().run(
    `UPDATE missions
        SET created_by_kind = 'agent',
            created_by_agent = 'cursor',
            created_at = ?,
            updated_at = ?
      WHERE id = ?`,
    [eightDaysAgo, eightDaysAgo, mission.id]
  );
  await updateMission(mission.id, { statusId: execute.id });

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === mission.id),
    false,
    'agent mission that left Next should not appear unless recent'
  );
});
