import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createServiceContext } from './context.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { seedServiceOperator } from './test-helpers.js';
import { newId, nowIso } from './util.js';

async function setup() {
  const db = createSqliteClient(openInMemoryDatabase());
  // The launch preference is keyed by workspace user, so the context needs a real
  // actor for the defaulting to resolve a stored selection.
  await seedServiceOperator({ db });
  const ctx = await createServiceContext({ db, source: 'cli' });
  return { db, ctx };
}

async function setLaunchPreference(
  ctx: Awaited<ReturnType<typeof createServiceContext>>,
  projectId: string,
  preference: {
    selectedAgent: string;
    selectedModel?: string | null;
    selectedReasoningEffort?: string | null;
  }
): Promise<void> {
  const now = nowIso();
  await ctx.db.run(
    `INSERT INTO project_user_preferences
         (id, workspace_id, project_id, workspace_user_id, preferences_json,
          created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      newId(),
      ctx.workspace.id,
      projectId,
      ctx.actorWorkspaceUserId,
      JSON.stringify({
        launchPreference: {
          selectedAgent: preference.selectedAgent,
          selectedModel: preference.selectedModel ?? null,
          selectedReasoningEffort: preference.selectedReasoningEffort ?? null
        }
      }),
      now,
      now
    ]
  );
}

async function agentOf(
  ctx: Awaited<ReturnType<typeof createServiceContext>>,
  objectiveId: string
): Promise<{
  assigned_agent: string | null;
  model: string | null;
  reasoning_effort: string | null;
}> {
  return (await ctx.db.get(
    `SELECT assigned_agent, model, reasoning_effort FROM objectives WHERE id = ?`,
    [objectiveId]
  )) as {
    assigned_agent: string | null;
    model: string | null;
    reasoning_effort: string | null;
  };
}

describe('objective creation agent defaulting', () => {
  it('stamps draft and future objectives with the project last-used agent', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Default Agent' });
    await setLaunchPreference(ctx, project.id, {
      selectedAgent: 'claude',
      selectedModel: 'claude-opus-4-8',
      selectedReasoningEffort: 'high'
    });

    const { objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Draft step' }, { objective: 'Future step' }]
    });

    // Both the draft (index 0) and future (index 1) slots record the agent so the
    // launch button and any later auto-advance read a populated db, never null.
    for (const objective of objectives) {
      const stored = await agentOf(ctx, objective.id);
      assert.equal(stored.assigned_agent, 'claude');
      assert.equal(stored.model, 'claude-opus-4-8');
      assert.equal(stored.reasoning_effort, 'high');
    }

    await db.close();
  });

  it('honors an explicit per-objective agent and model over the project preference', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Explicit Agent' });
    await setLaunchPreference(ctx, project.id, {
      selectedAgent: 'claude',
      selectedModel: 'claude-opus-4-8',
      selectedReasoningEffort: 'high'
    });

    // The point of the change: a mission can be created with its first objective
    // already assigned, instead of appending a second objective just to name one.
    const { objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Draft step', agent: 'codex', model: 'gpt-5.6-terra' },
        { objective: 'Future step' }
      ]
    });

    const first = await agentOf(ctx, objectives[0]?.id as string);
    assert.equal(first.assigned_agent, 'codex');
    assert.equal(first.model, 'gpt-5.6-terra');
    // An explicit selection carries no reasoning effort of its own, and must not
    // borrow the project preference's.
    assert.equal(first.reasoning_effort, null);

    const second = await agentOf(ctx, objectives[1]?.id as string);
    assert.equal(second.assigned_agent, 'claude');

    await db.close();
  });

  it('rejects a per-objective model with no agent', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Model Without Agent' });

    await assert.rejects(
      createMissionWithObjectives({
        ctx,
        projectId: project.id,
        objectives: [{ objective: 'Draft step', model: 'gpt-5.6-terra' }]
      }),
      /model requires an assigned agent/
    );

    await db.close();
  });

  it('leaves the agent unset when the project has no launch preference', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'No Preference' });

    const { objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Draft step' }]
    });

    const stored = await agentOf(ctx, objectives[0]?.id as string);
    assert.equal(stored.assigned_agent, null);

    await db.close();
  });
});
