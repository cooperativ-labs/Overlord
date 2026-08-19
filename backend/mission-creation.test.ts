import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// Characterization tests for the REST mission-creation surface. `createMission`
// delegates to the shared `createMissionWithObjectives` service function, so
// these lock in the field set REST has always accepted (priority, due date,
// assignee, tags, explicit status column) and the validation errors it answers
// with, independently of the CLI/Protocol surface that shares the same code.

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-mission-creation-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { createMission, createProject, createProjectTag, getMissionDetail, listProjectStatuses } =
  await import('./repository.ts');
const { db, WORKSPACE } = await import('./db.ts');
const { ApiError } = await import('./errors.ts');

function operatorWorkspaceUserId(): string {
  const row = db
    .prepare(
      `SELECT id FROM workspace_users
         WHERE workspace_id = ? AND status = 'active' AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`
    )
    .get(WORKSPACE.id) as { id: string };
  return row.id;
}

describe('REST mission creation', () => {
  it('records priority, due date and the creator as assignee by default', async () => {
    const project = await createProject({ name: 'REST Create Fields' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Ship the thing',
      priority: 'high',
      dueDatetime: '2026-09-01T12:00:00.000Z'
    });

    assert.equal(mission.priority, 'high');
    assert.equal(mission.dueDatetime, '2026-09-01T12:00:00.000Z');
    assert.equal(mission.assignedWorkspaceUserId, operatorWorkspaceUserId());
  });

  it('defaults priority to normal and leaves the due date unset', async () => {
    const project = await createProject({ name: 'REST Create Defaults' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Ship the default thing'
    });

    assert.equal(mission.priority, 'normal');
    assert.equal(mission.dueDatetime, null);
  });

  it('honours an explicit null assignee', async () => {
    const project = await createProject({ name: 'REST Create Unassigned' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Nobody owns this yet',
      assignedWorkspaceUserId: null
    });

    assert.equal(mission.assignedWorkspaceUserId, null);
  });

  it('creates the mission into an explicitly chosen status column', async () => {
    const project = await createProject({ name: 'REST Create Status' });
    const statuses = await listProjectStatuses(project.id);
    const target = statuses.find(status => status.type === 'execute') ?? statuses[1]!;

    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Straight to work',
      statusId: target.id
    });

    assert.equal(mission.statusId, target.id);
    assert.equal(mission.statusType, target.type);
  });

  it('assigns project tags at creation time', async () => {
    const project = await createProject({ name: 'REST Create Tags' });
    const tag = await createProjectTag(project.id, { label: 'backend' });

    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Tagged work',
      tagIds: [tag.id]
    });

    const rows = db
      .prepare(`SELECT tag_id FROM mission_tags WHERE mission_id = ?`)
      .all(mission.id) as Array<{ tag_id: string }>;
    assert.deepEqual(
      rows.map(row => row.tag_id),
      [tag.id]
    );
  });

  it('rejects a tag that belongs to another project', async () => {
    const project = await createProject({ name: 'REST Create Tag Owner' });
    const other = await createProject({ name: 'REST Create Tag Foreigner' });
    const foreignTag = await createProjectTag(other.id, { label: 'foreign' });

    await assert.rejects(
      createMission({
        projectId: project.id,
        firstObjective: 'Borrowed tag',
        tagIds: [foreignTag.id]
      }),
      (err: unknown) => (err as { status?: number }).status === 400
    );
  });

  it('creates objective #1 as draft and the rest as future', async () => {
    const project = await createProject({ name: 'REST Create Objective States' });
    const mission = await createMission({
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }, { objective: 'Third' }]
    });

    assert.deepEqual(
      mission.objectives.map(objective => ({
        text: objective.instructionText,
        state: objective.state,
        position: objective.position
      })),
      [
        { text: 'First', state: 'draft', position: 0 },
        { text: 'Second', state: 'future', position: 1 },
        { text: 'Third', state: 'future', position: 2 }
      ]
    );
  });

  it('creates a title-only mission with no objectives', async () => {
    const project = await createProject({ name: 'REST Create Title Only' });
    const mission = await createMission({ projectId: project.id, title: 'Just a placeholder' });

    assert.equal(mission.title, 'Just a placeholder');
    assert.deepEqual(mission.objectives, []);
  });

  it('derives the mission title from the first objective when none is given', async () => {
    const project = await createProject({ name: 'REST Create Derived Title' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Investigate the flaky dispatcher test'
    });

    assert.equal(mission.title, 'Investigate the flaky dispatcher test');
  });

  it('does not expose the review short-circuit that the protocol surface has', async () => {
    // record-work creates completed objectives in the review column; REST has no
    // equivalent request field, so a plain create always lands in the default
    // column with a draft objective.
    const project = await createProject({ name: 'REST Create No Review' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Ordinary work'
    });

    const statuses = await listProjectStatuses(project.id);
    const defaultStatus = statuses.find(status => status.isDefault)!;
    assert.equal(mission.statusId, defaultStatus.id);
    assert.equal(mission.objectives[0]!.state, 'draft');
  });

  it('rejects a request with neither a title nor an objective', async () => {
    const project = await createProject({ name: 'REST Create No Instruction' });
    await assert.rejects(
      createMission({ projectId: project.id }),
      (err: unknown) => err instanceof ApiError && err.status === 400
    );
  });

  it('rejects an invalid priority', async () => {
    const project = await createProject({ name: 'REST Create Bad Priority' });
    await assert.rejects(
      createMission({
        projectId: project.id,
        firstObjective: 'Bad priority',
        priority: 'critical' as never
      }),
      (err: unknown) => err instanceof ApiError && err.status === 400
    );
  });

  it('rejects a malformed dueDatetime', async () => {
    const project = await createProject({ name: 'REST Create Bad Due Date' });
    await assert.rejects(
      createMission({
        projectId: project.id,
        firstObjective: 'Bad due date',
        dueDatetime: 'next tuesday'
      }),
      (err: unknown) => err instanceof ApiError && err.status === 400
    );
  });

  it('rejects an unknown status id', async () => {
    const project = await createProject({ name: 'REST Create Bad Status' });
    await assert.rejects(
      createMission({
        projectId: project.id,
        firstObjective: 'Bad status',
        statusId: 'not-a-status'
      }),
      (err: unknown) => (err as { status?: number }).status === 409
    );
  });

  it('rejects a blank objective in the middle of the list', async () => {
    const project = await createProject({ name: 'REST Create Blank Objective' });
    await assert.rejects(
      createMission({
        projectId: project.id,
        objectives: [{ objective: 'First' }, { objective: '   ' }]
      }),
      (err: unknown) => (err as { status?: number }).status === 400
    );
  });

  it('allocates sequential display ids within the workspace', async () => {
    const project = await createProject({ name: 'REST Create Sequence' });
    const first = await createMission({ projectId: project.id, firstObjective: 'One' });
    const second = await createMission({ projectId: project.id, firstObjective: 'Two' });

    const firstSeq = Number(first.displayId.split(':')[1]);
    const secondSeq = Number(second.displayId.split(':')[1]);
    assert.equal(secondSeq, firstSeq + 1);
    assert.equal(second.sequenceNumber, secondSeq);
  });

  it('writes a mission insert row to the change feed', async () => {
    const project = await createProject({ name: 'REST Create Change Feed' });
    const mission = await createMission({ projectId: project.id, firstObjective: 'Feed me' });

    const rows = db
      .prepare(
        `SELECT entity_type, operation, project_id, mission_id
           FROM entity_changes WHERE mission_id = ? ORDER BY seq ASC`
      )
      .all(mission.id) as Array<{
      entity_type: string;
      operation: string;
      project_id: string | null;
      mission_id: string | null;
    }>;

    assert.deepEqual(rows, [
      {
        entity_type: 'mission',
        operation: 'insert',
        project_id: project.id,
        mission_id: mission.id
      },
      {
        entity_type: 'objective',
        operation: 'insert',
        project_id: project.id,
        mission_id: mission.id
      }
    ]);
  });

  it('reads back through getMissionDetail with the same field values', async () => {
    const project = await createProject({ name: 'REST Create Roundtrip' });
    const created = await createMission({
      projectId: project.id,
      firstObjective: 'Roundtrip',
      priority: 'urgent',
      dueDatetime: '2026-10-05T08:30:00.000Z'
    });

    const detail = await getMissionDetail(created.id);
    assert.equal(detail.priority, 'urgent');
    assert.equal(detail.dueDatetime, '2026-10-05T08:30:00.000Z');
    assert.equal(detail.objectives.length, 1);
  });
});
