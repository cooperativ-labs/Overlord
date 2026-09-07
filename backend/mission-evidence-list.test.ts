import { MISSION_EVIDENCE_LIST_LIMIT } from '@overlord/contract';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-evidence-list-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db, WORKSPACE } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const { createMission, createProject, listMissionDeliveries, listMissionFileChanges } =
  await import('./repository.ts');
const { newId } = await import('./db.ts');

const JUST_UNDER = MISSION_EVIDENCE_LIST_LIMIT - 1;
const AT_CAP = MISSION_EVIDENCE_LIST_LIMIT;
const OVER_CAP = MISSION_EVIDENCE_LIST_LIMIT + 1;
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

function isoAt(index: number): string {
  return new Date(BASE_MS + index * 1000).toISOString();
}

async function createEvidenceMission() {
  const project = await createProject({ name: `Evidence list ${newId()}` });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Cap the evidence lists'
  });
  const objectiveId = mission.objectives[0]?.id;
  assert.ok(objectiveId);
  return { project, mission, objectiveId };
}

function insertDeliveries({
  missionId,
  projectId,
  objectiveId,
  count
}: {
  missionId: string;
  projectId: string;
  objectiveId: string;
  count: number;
}) {
  const insert = db.prepare(
    `INSERT INTO deliveries
       (id, workspace_id, project_id, mission_id, objective_id, session_id,
        summary, payload_json, verification_summary, follow_up_notes,
        delivered_at, delivered_by_workspace_user_id, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, NULL, ?, '{}', NULL, NULL, ?, NULL, ?, ?, 1)`
  );
  const run = db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const at = isoAt(index);
      insert.run(
        newId(),
        WORKSPACE.id,
        projectId,
        missionId,
        objectiveId,
        `Delivery ${index}`,
        at,
        at,
        at
      );
    }
  });
  run();
}

function insertFileChanges({
  missionId,
  projectId,
  objectiveId,
  count
}: {
  missionId: string;
  projectId: string;
  objectiveId: string;
  count: number;
}) {
  const insert = db.prepare(
    `INSERT INTO changed_files
       (id, workspace_id, project_id, mission_id, objective_id, file_path, vcs_status,
        current_diff_state, first_observed_at, last_observed_at, observed_metadata_json,
        created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, 'M', 'present', ?, ?, '{}', ?, ?, 1)`
  );
  const run = db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const at = isoAt(index);
      insert.run(
        newId(),
        WORKSPACE.id,
        projectId,
        missionId,
        objectiveId,
        `src/f-${index}.ts`,
        at,
        at,
        at,
        at
      );
    }
  });
  run();
}

test('listMissionDeliveries reports a complete page just under, at, and over the cap', async () => {
  const under = await createEvidenceMission();
  insertDeliveries({
    missionId: under.mission.id,
    projectId: under.project.id,
    objectiveId: under.objectiveId,
    count: JUST_UNDER
  });
  const underPage = await listMissionDeliveries(under.mission.id);
  assert.equal(underPage.limit, MISSION_EVIDENCE_LIST_LIMIT);
  assert.equal(underPage.total, JUST_UNDER);
  assert.equal(underPage.items.length, JUST_UNDER);
  assert.equal(underPage.items[0]?.summary, `Delivery ${JUST_UNDER - 1}`);
  assert.equal(underPage.items.at(-1)?.summary, 'Delivery 0');

  const at = await createEvidenceMission();
  insertDeliveries({
    missionId: at.mission.id,
    projectId: at.project.id,
    objectiveId: at.objectiveId,
    count: AT_CAP
  });
  const atPage = await listMissionDeliveries(at.mission.id);
  assert.equal(atPage.total, AT_CAP);
  assert.equal(atPage.items.length, AT_CAP);
  assert.equal(atPage.items[0]?.summary, `Delivery ${AT_CAP - 1}`);
  assert.equal(atPage.items.at(-1)?.summary, 'Delivery 0');

  const over = await createEvidenceMission();
  insertDeliveries({
    missionId: over.mission.id,
    projectId: over.project.id,
    objectiveId: over.objectiveId,
    count: OVER_CAP
  });
  const overPage = await listMissionDeliveries(over.mission.id);
  assert.equal(overPage.total, OVER_CAP);
  assert.equal(overPage.items.length, AT_CAP);
  assert.equal(overPage.items[0]?.summary, `Delivery ${OVER_CAP - 1}`);
  assert.equal(overPage.items.at(-1)?.summary, 'Delivery 1');
  assert.equal(
    overPage.items.some(item => item.summary === 'Delivery 0'),
    false,
    'oldest delivery is dropped when over the cap'
  );
});

test('listMissionFileChanges reports a complete page just under, at, and over the cap', async () => {
  const under = await createEvidenceMission();
  insertFileChanges({
    missionId: under.mission.id,
    projectId: under.project.id,
    objectiveId: under.objectiveId,
    count: JUST_UNDER
  });
  const underPage = await listMissionFileChanges(under.mission.id);
  assert.equal(underPage.limit, MISSION_EVIDENCE_LIST_LIMIT);
  assert.equal(underPage.total, JUST_UNDER);
  assert.equal(underPage.items.length, JUST_UNDER);
  assert.equal(underPage.items[0]?.filePath, `src/f-${JUST_UNDER - 1}.ts`);
  assert.equal(underPage.items.at(-1)?.filePath, 'src/f-0.ts');

  const at = await createEvidenceMission();
  insertFileChanges({
    missionId: at.mission.id,
    projectId: at.project.id,
    objectiveId: at.objectiveId,
    count: AT_CAP
  });
  const atPage = await listMissionFileChanges(at.mission.id);
  assert.equal(atPage.total, AT_CAP);
  assert.equal(atPage.items.length, AT_CAP);
  assert.equal(atPage.items[0]?.filePath, `src/f-${AT_CAP - 1}.ts`);
  assert.equal(atPage.items.at(-1)?.filePath, 'src/f-0.ts');

  const over = await createEvidenceMission();
  insertFileChanges({
    missionId: over.mission.id,
    projectId: over.project.id,
    objectiveId: over.objectiveId,
    count: OVER_CAP
  });
  const overPage = await listMissionFileChanges(over.mission.id);
  assert.equal(overPage.total, OVER_CAP);
  assert.equal(overPage.items.length, AT_CAP);
  assert.equal(overPage.items[0]?.filePath, `src/f-${OVER_CAP - 1}.ts`);
  assert.equal(overPage.items.at(-1)?.filePath, 'src/f-1.ts');
  assert.equal(
    overPage.items.some(item => item.filePath === 'src/f-0.ts'),
    false,
    'oldest file change is dropped when over the cap'
  );
});
