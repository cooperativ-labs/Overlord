import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import { createMissionWithObjectives, insertObjective } from './missions.js';
import { createProject } from './projects.js';
import { createSeededServiceContext } from './test-helpers.js';

// `createMissionWithObjectives` is shared by the CLI, Protocol, MCP and REST
// surfaces. The first group locks in the shape an agent surface gets when it
// passes nothing extra; the second covers the optional fields only the REST
// board supplies today, so neither surface can quietly acquire the other's
// behavior.

async function setup() {
  return createSeededServiceContext({ source: 'cli' });
}

async function missionRow(
  db: DatabaseClient,
  missionId: string
): Promise<{
  priority: string | null;
  due_datetime: string | null;
  assigned_workspace_user_id: string | null;
  status_type: string;
}> {
  return (await db.get(
    `SELECT priority, due_datetime, assigned_workspace_user_id, status_type
       FROM missions WHERE id = ?`,
    [missionId]
  )) as {
    priority: string | null;
    due_datetime: string | null;
    assigned_workspace_user_id: string | null;
    status_type: string;
  };
}

describe('createMissionWithObjectives — agent-surface defaults', () => {
  it('creates a normal-priority, unassigned, undated mission with no tags', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Defaults' });

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Do the agent thing' }]
    });

    const row = await missionRow(db, mission.id);
    assert.equal(row.priority, 'normal');
    assert.equal(row.due_datetime, null);
    assert.equal(row.assigned_workspace_user_id, null);

    const tags = (await db.all(`SELECT tag_id FROM mission_tags WHERE mission_id = ?`, [
      mission.id
    ])) as Array<{ tag_id: string }>;
    assert.deepEqual(tags, []);
  });

  it('sequences objective #1 as draft and the rest as future', async () => {
    const { ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Sequencing' });

    const { objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'One' }, { objective: 'Two' }, { objective: 'Three' }]
    });

    assert.deepEqual(
      objectives.map(objective => objective.state),
      ['draft', 'future', 'future']
    );
  });

  it('short-circuits every objective to complete for a review-status mission', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Review' });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Already done' }],
      statusType: 'review'
    });

    assert.deepEqual(
      objectives.map(objective => objective.state),
      ['complete']
    );
    assert.equal((await missionRow(db, mission.id)).status_type, 'review');
  });

  it('derives the mission title from the first objective', async () => {
    const { ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Title' });

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Audit the dispatcher' }]
    });

    assert.equal(mission.title, 'Audit the dispatcher');
  });

  it('rejects an empty objective list with no title to fall back on', async () => {
    const { ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Empty' });

    await assert.rejects(
      createMissionWithObjectives({ ctx, projectId: project.id, objectives: [] }),
      (err: unknown) => err instanceof ServiceError && err.status === 400
    );
  });

  it('rejects a blank first objective', async () => {
    const { ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Blank First' });

    await assert.rejects(
      createMissionWithObjectives({
        ctx,
        projectId: project.id,
        objectives: [{ objective: '   ' }]
      }),
      (err: unknown) => err instanceof ServiceError && err.status === 400
    );
  });
});

describe('createMissionWithObjectives — optional board fields', () => {
  it('persists priority, due date and assignee when supplied', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Board Fields' });

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Board-created work' }],
      priority: 'high',
      dueDatetime: '2026-09-01T12:00:00.000Z',
      assignedWorkspaceUserId: ctx.actorWorkspaceUserId
    });

    const row = await missionRow(db, mission.id);
    assert.equal(row.priority, 'high');
    assert.equal(row.due_datetime, '2026-09-01T12:00:00.000Z');
    assert.equal(row.assigned_workspace_user_id, ctx.actorWorkspaceUserId);
  });

  it('creates into an explicitly chosen status id', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Explicit Status' });
    const status = (await db.get(
      `SELECT id, type FROM project_statuses
         WHERE project_id = ? AND type = 'execute' AND deleted_at IS NULL LIMIT 1`,
      [project.id]
    )) as { id: string; type: string };

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Straight to execute' }],
      statusId: status.id
    });

    assert.equal(mission.statusId, status.id);
    assert.equal(mission.statusType, 'execute');
  });

  it('rejects an unknown status id', async () => {
    const { ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Unknown Status' });

    await assert.rejects(
      createMissionWithObjectives({
        ctx,
        projectId: project.id,
        objectives: [{ objective: 'Nowhere to go' }],
        statusId: 'not-a-status'
      }),
      (err: unknown) => err instanceof ServiceError && err.status === 409
    );
  });

  it('assigns project tags and rejects a tag from another project', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Tags' });
    const other = await createProject({ ctx, name: 'Core Tags Other' });

    const tagId = 'tag-core-own';
    const foreignTagId = 'tag-core-foreign';
    for (const [id, projectId] of [
      [tagId, project.id],
      [foreignTagId, other.id]
    ] as const) {
      await db.run(
        `INSERT INTO project_tags (id, workspace_id, project_id, label, color,
             created_at, updated_at, revision)
           VALUES (?, ?, ?, ?, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`,
        [id, ctx.workspace.id, projectId, id]
      );
    }

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Tagged' }],
      tagIds: [tagId]
    });
    const rows = (await db.all(`SELECT tag_id FROM mission_tags WHERE mission_id = ?`, [
      mission.id
    ])) as Array<{ tag_id: string }>;
    assert.deepEqual(
      rows.map(row => row.tag_id),
      [tagId]
    );

    await assert.rejects(
      createMissionWithObjectives({
        ctx,
        projectId: project.id,
        objectives: [{ objective: 'Borrowed tag' }],
        tagIds: [foreignTagId]
      }),
      (err: unknown) => err instanceof ServiceError && err.status === 400
    );
  });

  it('creates a title-only mission with no objectives', async () => {
    const { ctx } = await setup();
    const project = await createProject({ ctx, name: 'Core Title Only' });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [],
      title: 'Placeholder mission'
    });

    assert.equal(mission.title, 'Placeholder mission');
    assert.deepEqual(objectives, []);
  });
});

describe('createMissionWithObjectives — creation provenance', () => {
  async function provenanceRow(
    db: DatabaseClient,
    missionId: string
  ): Promise<{
    created_by_kind: string;
    created_by_agent: string | null;
    created_by_session_id: string | null;
  }> {
    return (await db.get(
      `SELECT created_by_kind, created_by_agent, created_by_session_id
         FROM missions WHERE id = ?`,
      [missionId]
    )) as {
      created_by_kind: string;
      created_by_agent: string | null;
      created_by_session_id: string | null;
    };
  }

  it("stamps 'agent' for a protocol-source context", async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Provenance Protocol' });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Filed by an agent surface' }]
    });

    const missionRow = await provenanceRow(db, mission.id);
    assert.equal(missionRow.created_by_kind, 'agent');
    assert.equal(missionRow.created_by_agent, null);
    assert.equal(missionRow.created_by_session_id, null);

    const objectiveRow = (await db.get(`SELECT created_by_kind FROM objectives WHERE id = ?`, [
      objectives[0]!.id
    ])) as { created_by_kind: string };
    assert.equal(objectiveRow.created_by_kind, 'agent');
  });

  it("stamps 'human' for a webapp-source context", async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const project = await createProject({ ctx, name: 'Provenance Webapp' });

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Typed on the board' }]
    });

    assert.equal((await provenanceRow(db, mission.id)).created_by_kind, 'human');
  });

  it('lets an explicit ctx.origin win over the source default', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const project = await createProject({ ctx, name: 'Provenance Explicit' });

    const { mission } = await createMissionWithObjectives({
      ctx: {
        ...ctx,
        origin: {
          kind: 'agent',
          agent: 'claude-code',
          sessionId: 'session-explicit-1'
        }
      },
      projectId: project.id,
      objectives: [{ objective: 'Explicit origin override' }]
    });

    const row = await provenanceRow(db, mission.id);
    assert.equal(row.created_by_kind, 'agent');
    assert.equal(row.created_by_agent, 'claude-code');
    assert.equal(row.created_by_session_id, 'session-explicit-1');
  });

  it("stamps an objective from its creating context, independent of the mission's kind", async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const project = await createProject({ ctx, name: 'Provenance Independent' });

    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Human-authored mission' }]
    });
    assert.equal((await provenanceRow(db, mission.id)).created_by_kind, 'human');

    const agentObjective = await insertObjective({
      ctx: {
        ...ctx,
        origin: { kind: 'agent', agent: 'cursor', sessionId: null }
      },
      missionId: mission.id,
      instructionText: 'Agent-added follow-up'
    });

    const objectiveRow = (await db.get(
      `SELECT created_by_kind, created_by_agent FROM objectives WHERE id = ?`,
      [agentObjective.id]
    )) as { created_by_kind: string; created_by_agent: string | null };
    assert.equal(objectiveRow.created_by_kind, 'agent');
    assert.equal(objectiveRow.created_by_agent, 'cursor');

    const humanObjective = (await db.get(
      `SELECT created_by_kind FROM objectives
         WHERE mission_id = ? AND id != ? AND deleted_at IS NULL
         ORDER BY position ASC LIMIT 1`,
      [mission.id, agentObjective.id]
    )) as { created_by_kind: string };
    assert.equal(humanObjective.created_by_kind, 'human');
  });

  it('rejects a fourth created_by_kind via CHECK', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const project = await createProject({ ctx, name: 'Provenance Check' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Baseline' }]
    });

    await assert.rejects(
      db.run(`UPDATE missions SET created_by_kind = 'bot' WHERE id = ?`, [mission.id]),
      (err: unknown) =>
        err instanceof Error && /CHECK|constraint|created_by_kind/i.test(String(err.message))
    );
  });
});
