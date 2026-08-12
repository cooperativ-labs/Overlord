import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { claimNextExecutionRequest } from './execution-requests.js';
import {
  ensureCallerDeviceTarget,
  readActorLaunchSessionDefaults,
  updateActorLaunchSessionDefaults,
  updateTerminalProfile
} from './execution-targets.js';
import { createMissionWithObjectives } from './missions.js';
import { resolveLaunchSessionForExecutionTarget } from './project-execution-target.js';
import { addProjectResource, createProject } from './projects.js';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.js';
import { newId, nowIso } from './util.js';

/**
 * The Latch integration separates *who creates the process* from *what shows it*.
 * These tests pin the storage consequences: a machine that never opted in keeps
 * launching directly, the user-level default is what a target follows until it
 * overrides, and a claim freezes both so a later settings change cannot rewrite
 * what a finished run did.
 */

/** A project with a linked checkout on the acting machine, plus a queued request. */
async function seedQueuedRequest(ctx: ServiceContext, name: string): Promise<string> {
  const project = await createProject({ ctx, name });
  await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: createIsolatedCheckout('ovld-launch-session-'),
    isPrimary: true
  });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Run somewhere' }]
  });
  const requestId = newId();
  const now = nowIso();
  await ctx.db.run(
    `INSERT INTO execution_requests
       (id, workspace_id, project_id, mission_id, objective_id, requested_agent,
        launch_mode, launch_flags_json, requested_source, status,
        created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, 'codex', 'run', '{}', 'cli', 'queued', ?, ?, 1)`,
    [requestId, ctx.workspace.id, project.id, mission.id, objectives[0]?.id, now, now]
  );
  return requestId;
}

describe('execution provider and viewer settings', () => {
  it('leaves an untouched target launching directly with its stored terminal choice', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const target = await ensureCallerDeviceTarget({ ctx });

    const resolved = await resolveLaunchSessionForExecutionTarget({
      ctx,
      executionTargetId: target.executionTargetId
    });

    assert.equal(resolved.executionProvider.kind, 'direct');
    assert.equal(resolved.viewer.openOnLaunch, true);
    assert.equal(resolved.executionProviderSource, 'user_default');
    await db.close();
  });

  it('lets a target inherit the user default and then override it', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const target = await ensureCallerDeviceTarget({ ctx });

    await updateActorLaunchSessionDefaults({
      ctx,
      executionProvider: { kind: 'latch', executable: 'latch' }
    });

    const inherited = await resolveLaunchSessionForExecutionTarget({
      ctx,
      executionTargetId: target.executionTargetId
    });
    assert.equal(inherited.executionProvider.kind, 'latch');
    assert.equal(inherited.executionProviderSource, 'user_default');

    await updateTerminalProfile({
      ctx,
      profile: {
        ...target.terminalProfile,
        executionProvider: { kind: 'direct', executable: 'latch' }
      }
    });

    const overridden = await resolveLaunchSessionForExecutionTarget({
      ctx,
      executionTargetId: target.executionTargetId
    });
    assert.equal(overridden.executionProvider.kind, 'direct');
    assert.equal(overridden.executionProviderSource, 'target');
    await db.close();
  });

  it('keeps the terminal choice across a provider toggle', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const target = await ensureCallerDeviceTarget({ ctx });

    await updateTerminalProfile({
      ctx,
      profile: { launcher: 'iTerm2', placement: 'chord', chord: 'cmd+d', background: true }
    });
    await updateTerminalProfile({
      ctx,
      profile: {
        launcher: 'iTerm2',
        placement: 'chord',
        chord: 'cmd+d',
        background: true,
        executionProvider: { kind: 'latch', executable: 'latch' }
      }
    });

    const resolved = await resolveLaunchSessionForExecutionTarget({
      ctx,
      executionTargetId: target.executionTargetId
    });
    assert.equal(resolved.executionProvider.kind, 'latch');
    assert.equal(resolved.viewer.launcher, 'iTerm2');
    assert.equal(resolved.viewer.kind, 'iterm');

    const stored = (await db.get(
      `SELECT terminal_profile_json FROM user_execution_target_preferences WHERE id = ?`,
      [target.preferenceId]
    )) as { terminal_profile_json: string };
    const parsed = JSON.parse(stored.terminal_profile_json) as Record<string, unknown>;
    assert.equal(parsed.launcher, 'iTerm2');
    assert.equal(parsed.chord, 'cmd+d');
    assert.equal(parsed.background, true);
    await db.close();
  });

  it('updates one user default field without disturbing the other', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    await ensureCallerDeviceTarget({ ctx });

    await updateActorLaunchSessionDefaults({ ctx, openViewerOnLaunch: false });
    await updateActorLaunchSessionDefaults({
      ctx,
      executionProvider: { kind: 'latch', executable: '/opt/latch' }
    });

    const defaults = await readActorLaunchSessionDefaults({ ctx });
    assert.equal(defaults.openViewerOnLaunch, false);
    assert.deepEqual(defaults.executionProvider, { kind: 'latch', executable: '/opt/latch' });
    await db.close();
  });
});

describe('claim-time launch session snapshot', () => {
  it('freezes the provider and viewer a run actually used', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    await ensureCallerDeviceTarget({ ctx });
    await updateTerminalProfile({
      ctx,
      profile: {
        launcher: 'iTerm2',
        placement: 'window',
        chord: null,
        executionProvider: { kind: 'latch', executable: 'latch' }
      }
    });
    const requestId = await seedQueuedRequest(ctx, 'Snapshot at claim');

    const claimed = await claimNextExecutionRequest({ ctx });
    assert.equal(claimed?.id, requestId);
    assert.equal(claimed?.launchSession?.executionProvider.kind, 'latch');
    assert.equal(claimed?.launchSession?.viewer.launcher, 'iTerm2');
    assert.ok(claimed?.launchSession?.resolvedAt);

    // Settings change after the claim: the snapshot must not move with it.
    await updateTerminalProfile({
      ctx,
      profile: { launcher: 'Terminal', placement: 'window', chord: null }
    });
    const row = (await db.get(`SELECT metadata_json FROM execution_requests WHERE id = ?`, [
      requestId
    ])) as { metadata_json: string };
    const metadata = JSON.parse(row.metadata_json) as {
      launchSession: { executionProvider: { kind: string }; viewer: { launcher: string } };
    };
    assert.equal(metadata.launchSession.executionProvider.kind, 'latch');
    assert.equal(metadata.launchSession.viewer.launcher, 'iTerm2');
    await db.close();
  });

  it('records a direct snapshot for a machine that never opted in', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    await ensureCallerDeviceTarget({ ctx });
    await seedQueuedRequest(ctx, 'Direct snapshot');

    const claimed = await claimNextExecutionRequest({ ctx });
    assert.equal(claimed?.launchSession?.executionProvider.kind, 'direct');
    assert.equal(claimed?.launchSession?.viewer.openOnLaunch, true);
    await db.close();
  });
});
