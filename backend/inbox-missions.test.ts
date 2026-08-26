import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-inbox-missions-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { requireDatabaseClient } = await import('./db.ts');
const {
  createMission,
  createProject,
  listInboxMissions,
  listProjectStatuses,
  updateMission,
  updateProject
} = await import('./repository.ts');

async function statusFor(projectId: string, key: string) {
  const status = (await listProjectStatuses(projectId)).find(item => item.key === key);
  assert.ok(status, `expected ${key} status for project ${projectId}`);
  return status;
}

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('listInboxMissions omits recently created human non-Next missions', async () => {
  const project = await createProject({ name: 'Inbox recent project' });
  const execute = await statusFor(project.id, 'in_progress');
  const mission = await createMission({
    projectId: project.id,
    title: 'Fresh human mission',
    statusId: execute.id,
    firstObjective: 'Do the thing'
  });

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === mission.id),
    false,
    'human missions must not appear in inbox triage regardless of status or age'
  );
});

test('listInboxMissions omits human Next missions even when recent', async () => {
  const project = await createProject({ name: 'Inbox human next project' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Fresh human next mission',
    statusId: next.id,
    firstObjective: 'Human next work'
  });

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === mission.id),
    false,
    'human Next missions must not appear in inbox triage'
  );
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

test('listInboxMissions includes recent agent Next missions', async () => {
  const project = await createProject({ name: 'Inbox recent agent next' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Fresh agent next work',
    statusId: next.id,
    firstObjective: 'Agent triage'
  });

  await requireDatabaseClient().run(
    `UPDATE missions
        SET created_by_kind = 'agent',
            created_by_agent = 'cursor'
      WHERE id = ?`,
    [mission.id]
  );

  const response = await listInboxMissions();
  const found = response.missions.find(item => item.id === mission.id);
  assert.ok(found, 'expected recent agent Next mission in inbox list');
  assert.ok(found.reasons.includes('agent_next'));
  assert.ok(found.reasons.includes('recent'));
  assert.equal(found.createdByKind, 'agent');
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

/** Noon UTC on the UTC day `offsetDays` from today — the anchor the UI writes. */
function dueDatetimeDaysFromNow(offsetDays: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, 12, 0, 0)
  ).toISOString();
}

async function setDueDatetime(missionId: string, dueDatetime: string) {
  await requireDatabaseClient().run(`UPDATE missions SET due_datetime = ? WHERE id = ?`, [
    dueDatetime,
    missionId
  ]);
}

test('listInboxMissions includes human missions due today or tomorrow', async () => {
  const project = await createProject({ name: 'Inbox due soon project' });
  const execute = await statusFor(project.id, 'in_progress');
  const dueToday = await createMission({
    projectId: project.id,
    title: 'Human mission due today',
    statusId: execute.id,
    firstObjective: 'Ship today'
  });
  const dueTomorrow = await createMission({
    projectId: project.id,
    title: 'Human mission due tomorrow',
    statusId: execute.id,
    firstObjective: 'Ship tomorrow'
  });
  await setDueDatetime(dueToday.id, dueDatetimeDaysFromNow(0));
  await setDueDatetime(dueTomorrow.id, dueDatetimeDaysFromNow(1));

  const response = await listInboxMissions();
  const today = response.missions.find(item => item.id === dueToday.id);
  const tomorrow = response.missions.find(item => item.id === dueTomorrow.id);
  assert.ok(today, 'expected mission due today in inbox list');
  assert.ok(tomorrow, 'expected mission due tomorrow in inbox list');
  assert.ok(today.reasons.includes('due_soon'));
  assert.ok(tomorrow.reasons.includes('due_soon'));
  assert.equal(today.reasons.includes('agent_next'), false);
});

test('listInboxMissions omits missions due later than tomorrow but includes past due', async () => {
  const project = await createProject({ name: 'Inbox due window project' });
  const execute = await statusFor(project.id, 'in_progress');
  const dueLater = await createMission({
    projectId: project.id,
    title: 'Due in three days',
    statusId: execute.id,
    firstObjective: 'Later work'
  });
  const dueYesterday = await createMission({
    projectId: project.id,
    title: 'Due yesterday',
    statusId: execute.id,
    firstObjective: 'Past work'
  });
  await setDueDatetime(dueLater.id, dueDatetimeDaysFromNow(3));
  await setDueDatetime(dueYesterday.id, dueDatetimeDaysFromNow(-1));

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === dueLater.id),
    false,
    'missions due beyond tomorrow stay off the inbox'
  );
  const yesterday = response.missions.find(item => item.id === dueYesterday.id);
  assert.ok(yesterday, 'expected the past-due mission in the inbox list');
  assert.ok(yesterday.reasons.includes('overdue'));
  assert.equal(
    yesterday.reasons.includes('due_soon'),
    false,
    'overdue and due_soon are mutually exclusive'
  );
});

test('listInboxMissions orders overdue rows most recently overdue first, ahead of due soon', async () => {
  const project = await createProject({ name: 'Inbox overdue ordering project' });
  const execute = await statusFor(project.id, 'in_progress');
  const dueLongAgo = await createMission({
    projectId: project.id,
    title: 'Overdue by a month',
    statusId: execute.id,
    firstObjective: 'Stale work'
  });
  const dueRecently = await createMission({
    projectId: project.id,
    title: 'Overdue by two days',
    statusId: execute.id,
    firstObjective: 'Recently missed work'
  });
  const dueToday = await createMission({
    projectId: project.id,
    title: 'Ordering due today',
    statusId: execute.id,
    firstObjective: 'Due today'
  });
  await setDueDatetime(dueLongAgo.id, dueDatetimeDaysFromNow(-30));
  await setDueDatetime(dueRecently.id, dueDatetimeDaysFromNow(-2));
  await setDueDatetime(dueToday.id, dueDatetimeDaysFromNow(0));

  const response = await listInboxMissions();
  const recentIndex = response.missions.findIndex(item => item.id === dueRecently.id);
  const staleIndex = response.missions.findIndex(item => item.id === dueLongAgo.id);
  const todayIndex = response.missions.findIndex(item => item.id === dueToday.id);
  assert.ok(recentIndex >= 0 && staleIndex >= 0 && todayIndex >= 0, 'expected all three rows');
  assert.ok(recentIndex < staleIndex, 'overdue rows read most recently overdue first');
  assert.ok(staleIndex < todayIndex, 'overdue rows lead the due-soon rows');
});

test('listInboxMissions omits completed missions that are past due', async () => {
  const project = await createProject({ name: 'Inbox overdue finished project' });
  const complete = await statusFor(project.id, 'done');
  const mission = await createMission({
    projectId: project.id,
    title: 'Finished mission due last week',
    statusId: complete.id,
    firstObjective: 'Already done'
  });
  await setDueDatetime(mission.id, dueDatetimeDaysFromNow(-7));

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === mission.id),
    false,
    'finished work is not triage even when its due date has passed'
  );
});

test('listInboxMissions carries both reasons for an overdue agent Next mission', async () => {
  const project = await createProject({ name: 'Inbox overdue agent next project' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Agent next mission past due',
    statusId: next.id,
    firstObjective: 'Agent work past due'
  });
  await requireDatabaseClient().run(
    `UPDATE missions SET created_by_kind = 'agent', created_by_agent = 'cursor' WHERE id = ?`,
    [mission.id]
  );
  await setDueDatetime(mission.id, dueDatetimeDaysFromNow(-3));

  const response = await listInboxMissions();
  const matches = response.missions.filter(item => item.id === mission.id);
  assert.equal(matches.length, 1, 'a mission qualifying twice is still one card');
  assert.ok(matches[0].reasons.includes('overdue'));
  assert.ok(matches[0].reasons.includes('agent_next'));
});

test('listInboxMissions excludes all missions in archived projects', async () => {
  const project = await createProject({ name: 'Archived inbox project' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Archived agent mission due today',
    statusId: next.id,
    firstObjective: 'Do not surface this objective'
  });
  await requireDatabaseClient().run(
    `UPDATE missions SET created_by_kind = 'agent', created_by_agent = 'cursor' WHERE id = ?`,
    [mission.id]
  );
  await setDueDatetime(mission.id, dueDatetimeDaysFromNow(0));
  await updateProject(project.id, { status: 'archived' });

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === mission.id),
    false,
    'archived-project missions stay out even when agent-next and due soon'
  );
});

test('listInboxMissions omits completed and cancelled missions due today', async () => {
  const project = await createProject({ name: 'Inbox due finished project' });
  const complete = await statusFor(project.id, 'done');
  const mission = await createMission({
    projectId: project.id,
    title: 'Finished mission due today',
    statusId: complete.id,
    firstObjective: 'Already done'
  });
  await setDueDatetime(mission.id, dueDatetimeDaysFromNow(0));

  const response = await listInboxMissions();
  assert.equal(
    response.missions.some(item => item.id === mission.id),
    false,
    'finished work is not triage even when its due date is today'
  );
});

test('listInboxMissions carries both reasons for an agent Next mission due today', async () => {
  const project = await createProject({ name: 'Inbox due agent next project' });
  const next = await statusFor(project.id, 'next_up');
  const mission = await createMission({
    projectId: project.id,
    title: 'Agent next mission due today',
    statusId: next.id,
    firstObjective: 'Agent work due today'
  });
  await requireDatabaseClient().run(
    `UPDATE missions SET created_by_kind = 'agent', created_by_agent = 'cursor' WHERE id = ?`,
    [mission.id]
  );
  await setDueDatetime(mission.id, dueDatetimeDaysFromNow(0));

  const response = await listInboxMissions();
  const matches = response.missions.filter(item => item.id === mission.id);
  assert.equal(matches.length, 1, 'a mission qualifying twice is still one card');
  assert.ok(matches[0].reasons.includes('due_soon'));
  assert.ok(matches[0].reasons.includes('agent_next'));
});

test('listInboxMissions orders due-soon rows ahead of agent Next rows', async () => {
  const project = await createProject({ name: 'Inbox due ordering project' });
  const next = await statusFor(project.id, 'next_up');
  const execute = await statusFor(project.id, 'in_progress');
  const agentNext = await createMission({
    projectId: project.id,
    title: 'Ordering agent next',
    statusId: next.id,
    firstObjective: 'Agent triage'
  });
  await requireDatabaseClient().run(
    `UPDATE missions SET created_by_kind = 'agent', created_by_agent = 'cursor' WHERE id = ?`,
    [agentNext.id]
  );
  const dueTomorrow = await createMission({
    projectId: project.id,
    title: 'Ordering due tomorrow',
    statusId: execute.id,
    firstObjective: 'Due tomorrow'
  });
  await setDueDatetime(dueTomorrow.id, dueDatetimeDaysFromNow(1));

  const response = await listInboxMissions();
  const dueIndex = response.missions.findIndex(item => item.id === dueTomorrow.id);
  const agentIndex = response.missions.findIndex(item => item.id === agentNext.id);
  assert.ok(dueIndex >= 0 && agentIndex >= 0, 'expected both rows in the inbox list');
  assert.ok(dueIndex < agentIndex, 'due-soon rows lead the list');
});
