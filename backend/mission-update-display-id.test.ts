import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// Regression coverage for coo:957: `PATCH /api/missions/:id` accepts a mission
// reference, which may be the workspace display id (`coo:955`) rather than a
// UUID. The update path used to resolve that reference only for the permission
// check and then pass the raw reference through to the row update, the tag
// sync and the change-feed write — so the UPDATE silently matched zero rows and
// the `entity_changes.mission_id` foreign key blew up on the display id.

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-mission-update-display-id-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const {
  createMission,
  createProject,
  createProjectTag,
  getMissionDetail,
  listProjectStatuses,
  updateMission
} = await import('./repository.ts');
const { db } = await import('./db.ts');

interface ChangeRow {
  entity_id: string;
  mission_id: string | null;
  project_id: string | null;
  changed_fields_json: string;
}

function latestMissionChange(missionId: string): ChangeRow {
  const row = db
    .prepare(
      `SELECT entity_id, mission_id, project_id, changed_fields_json
         FROM entity_changes
        WHERE entity_type = 'mission' AND entity_id = ?
        ORDER BY seq DESC LIMIT 1`
    )
    .get(missionId) as ChangeRow | undefined;
  assert.ok(row, 'a mission change-feed entry keyed on the mission UUID should exist');
  return row;
}

describe('mission update by display id', () => {
  it('patches fields and records the change against the mission UUID', async () => {
    const project = await createProject({ name: 'Display Id Patch' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Rename me by display id'
    });
    assert.ok(mission.displayId, 'the mission should have a display id to patch by');
    assert.notEqual(mission.displayId, mission.id);

    const updated = await updateMission(mission.displayId, {
      title: 'Renamed via display id',
      priority: 'high'
    });

    assert.equal(updated.id, mission.id);
    assert.equal(updated.title, 'Renamed via display id');
    assert.equal(updated.priority, 'high');

    // The row itself must have moved, not just the returned DTO.
    const detail = await getMissionDetail(mission.id);
    assert.equal(detail.title, 'Renamed via display id');
    assert.equal(detail.revision, mission.revision + 1);

    const change = latestMissionChange(mission.id);
    assert.equal(change.mission_id, mission.id, 'change feed must store the resolved UUID');
    assert.equal(change.project_id, project.id);
    assert.deepEqual(JSON.parse(change.changed_fields_json), ['title', 'priority']);
  });

  it('syncs tags and status transitions when addressed by display id', async () => {
    const project = await createProject({ name: 'Display Id Status' });
    const tag = await createProjectTag(project.id, { label: 'display-id-tag' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Move me by display id'
    });
    const execute = (await listProjectStatuses(project.id)).find(
      status => status.type === 'execute'
    )!;

    const updated = await updateMission(mission.displayId, {
      statusId: execute.id,
      tagIds: [tag.id]
    });

    assert.equal(updated.statusId, execute.id);
    assert.deepEqual(
      updated.tags.map(missionTag => missionTag.id),
      [tag.id]
    );

    const tagged = db
      .prepare(`SELECT mission_id FROM mission_tags WHERE tag_id = ?`)
      .all(tag.id) as Array<{ mission_id: string }>;
    assert.deepEqual(
      tagged.map(row => row.mission_id),
      [mission.id],
      'tags must be attached to the mission UUID, not the display id'
    );

    assert.equal(latestMissionChange(mission.id).mission_id, mission.id);
  });

  it('moves the mission across projects when addressed by display id', async () => {
    const source = await createProject({ name: 'Display Id Move Source' });
    const target = await createProject({ name: 'Display Id Move Target' });
    const mission = await createMission({
      projectId: source.id,
      firstObjective: 'Move projects by display id'
    });

    const updated = await updateMission(mission.displayId, { projectId: target.id });

    assert.equal(updated.id, mission.id);
    assert.equal(updated.projectId, target.id);

    const detail = await getMissionDetail(mission.id);
    assert.equal(detail.projectId, target.id);
    assert.equal(detail.objectives[0]?.projectId, target.id);

    const change = latestMissionChange(mission.id);
    assert.equal(change.mission_id, mission.id);
    assert.equal(change.project_id, target.id);
  });
});
