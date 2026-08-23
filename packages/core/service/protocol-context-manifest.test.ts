import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives } from './missions.js';
import { buildProjectResourceManifestEntries } from './project-resource-manifest.js';
import { addProjectResource, createProject } from './projects.js';
import { attachSession, loadMissionContext, syncChanges } from './protocol.js';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.js';

describe('protocol context manifest', () => {
  it('buildProjectResourceManifestEntries marks current resource and omits instructions for single repo', () => {
    const entries = buildProjectResourceManifestEntries({
      resources: [
        {
          id: 'res-1',
          resourceKey: 'backend',
          label: 'Backend',
          path: '/tmp/backend',
          isPrimary: true,
          executionTargetId: 'target-1'
        }
      ],
      executionTargetId: 'target-1',
      currentResourceKey: 'backend',
      observationStatesByResourceId: new Map([['res-1', 'available']])
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.isCurrent, true);
    assert.equal(entries[0]?.path, '/tmp/backend');
    assert.equal(entries[0]?.state, 'available');
  });

  it('loadMissionContext includes projectResources and instructions for multi-resource projects', async () => {
    const { db, ctx } = await createSeededServiceContext();
    const project = await createProject({ ctx, name: 'Multi Repo Project' });
    const backendDir = createIsolatedCheckout('ovld-backend-');
    const mobileDir = createIsolatedCheckout('ovld-mobile-');

    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: backendDir,
      resourceKey: 'backend',
      isPrimary: true
    });
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: mobileDir,
      resourceKey: 'mobile',
      isPrimary: false
    });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Cross-repo work', resourceKey: 'backend' }]
    });
    await db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

    const context = await loadMissionContext({ ctx, missionId: mission.id });
    assert.ok(context.projectResources);
    assert.equal(context.projectResources.length, 2);
    assert.match(context.agentInstructions, /## Project Resources/);
    assert.match(context.agentInstructions, /`backend`/);
    assert.match(context.agentInstructions, /`mobile`/);
  });

  it('attachSession omits project resources instructions for single-resource projects', async () => {
    const { db, ctx } = await createSeededServiceContext();
    const project = await createProject({ ctx, name: 'Single Repo Project' });
    // Never point a test resource at the real checkout: addProjectResource
    // writes .overlord/project.json into the directory it links.
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-single-'),
      isPrimary: true
    });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Single repo work' }]
    });
    await db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

    const attached = await attachSession({
      ctx,
      missionId: mission.id,
      agentIdentifier: 'test-agent'
    });
    assert.doesNotMatch(attached.agentInstructions, /## Project Resources/);
    assert.equal(attached.projectResources?.length, 1);
  });

  it('syncChanges stamps changed_files.resource_id from objective resourceKey without execution request', async () => {
    const { db, ctx } = await createSeededServiceContext();
    const project = await createProject({ ctx, name: 'Resource id fallback' });
    const resource = await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-fallback-'),
      resourceKey: 'backend',
      isPrimary: true
    });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Direct attach', resourceKey: 'backend' }]
    });
    await db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

    const attached = await attachSession({
      ctx,
      missionId: mission.id,
      agentIdentifier: 'test-agent'
    });
    await syncChanges({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/direct.ts',
          idempotencyKey: 'resource-binding-1',
          source: 'declared_edit',
          quality: 'direct'
        }
      ]
    });

    const changedFile = (await db.get(
      `SELECT resource_id, vcs_status, current_diff_state, observed_metadata_json
         FROM changed_files WHERE session_id = ? AND deleted_at IS NULL`,
      [attached.session.id]
    )) as {
      resource_id: string | null;
      vcs_status: string | null;
      current_diff_state: string;
      observed_metadata_json: string;
    };
    assert.equal(changedFile.resource_id, resource.id);
    assert.equal(changedFile.vcs_status, null);
    assert.equal(changedFile.current_diff_state, 'unknown');
    assert.equal(JSON.parse(changedFile.observed_metadata_json).overlap, false);
    await db.close();
  });

  it('syncChanges salvages malformed siblings and idempotently persists metadata-only evidence', async () => {
    const { db, ctx } = await createSeededServiceContext();
    const project = await createProject({ ctx, name: 'Change sync' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Sync metadata' }]
    });
    await db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);
    const attached = await attachSession({
      ctx,
      missionId: mission.id,
      agentIdentifier: 'test-agent'
    });

    const first = await syncChanges({
      ctx,
      missionId: mission.id,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/evidence.ts',
          idempotencyKey: 'evidence-1',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: '../escape.ts',
          idempotencyKey: 'parent-segment',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: '/absolute.ts',
          idempotencyKey: 'absolute',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'C:/drive.ts',
          idempotencyKey: 'drive',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'C:drive-relative.ts',
          idempotencyKey: 'drive-relative',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src\\windows.ts',
          idempotencyKey: 'backslash',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: ' src/leading-space.ts',
          idempotencyKey: 'leading-space',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src/trailing-space.ts ',
          idempotencyKey: 'trailing-space',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src//empty-segment.ts',
          idempotencyKey: 'empty-segment',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src/./dot-segment.ts',
          idempotencyKey: 'dot-segment',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src/retired-state.ts',
          idempotencyKey: 'retired-state',
          state: 'present',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src/retired-vcs-status.ts',
          idempotencyKey: 'retired-vcs-status',
          vcsStatus: 'modified',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        },
        {
          filePath: 'src/prohibited-content.ts',
          idempotencyKey: 'prohibited-content',
          content: 'must never cross the metadata-only boundary',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        }
      ]
    });
    assert.deepEqual(
      first.outcomes.map(entry => entry.status),
      ['accepted', ...Array.from({ length: 12 }, () => 'warning')]
    );
    assert.equal(
      first.outcomes.filter(entry => entry.warning?.includes('normalized repository-relative path'))
        .length,
      9
    );
    assert.equal(
      first.outcomes.filter(entry => entry.warning?.includes('unsupported fields')).length,
      3
    );
    assert.equal(first.outcomes.find(entry => entry.idempotencyKey === 'absolute')?.filePath, null);
    assert.equal(
      first.outcomes.some(entry => entry.filePath?.startsWith('/')),
      false
    );
    const overflow = await syncChanges({
      ctx,
      missionId: mission.id,
      sessionKey: attached.sessionKey,
      changes: [
        ...Array.from({ length: 25 }, (_, index) => ({
          filePath: `src/unsupported-${index}.ts`,
          idempotencyKey: `unsupported-${index}`,
          content: 'prohibited'
        })),
        { filePath: '/private/host-secret.ts', idempotencyKey: 'overflow-absolute' }
      ]
    });
    assert.equal(overflow.outcomes.at(-1)?.status, 'warning');
    assert.equal(overflow.outcomes.at(-1)?.filePath, null);
    const replay = await syncChanges({
      ctx,
      missionId: mission.id,
      sessionKey: attached.sessionKey,
      changes: [
        {
          filePath: 'src/evidence.ts',
          idempotencyKey: 'evidence-1',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false
        }
      ]
    });
    assert.equal(replay.outcomes[0]?.status, 'ignored');
    const secondSession = await attachSession({
      ctx,
      missionId: mission.id,
      agentIdentifier: 'second-test-agent'
    });
    const weaker = await syncChanges({
      ctx,
      missionId: mission.id,
      sessionKey: secondSession.sessionKey,
      changes: [
        {
          filePath: 'src/evidence.ts',
          idempotencyKey: 'evidence-2',
          source: 'window_observed',
          quality: 'window',
          overlap: true,
          toolWindowId: 'window-2'
        }
      ]
    });
    assert.equal(weaker.outcomes[0]?.status, 'accepted');
    const stored = (await db.get(
      `SELECT session_id, observed_metadata_json FROM changed_files WHERE objective_id = ? AND file_path = ?`,
      [attached.session.objectiveId, 'src/evidence.ts']
    )) as { session_id: string | null; observed_metadata_json: string };
    assert.equal(stored.session_id, secondSession.session.id);
    assert.deepEqual(JSON.parse(stored.observed_metadata_json), {
      source: 'declared_edit',
      quality: 'direct',
      overlap: true,
      syncKeys: ['evidence-1', 'evidence-2']
    });
    await db.close();
  });
});
