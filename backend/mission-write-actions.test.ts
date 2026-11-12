import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Regenerating a mission title and forgetting a terminal session change
 * stored state, so they require the matching write actions (`mission:update`
 * and `session:attach`), not only read access.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-mission-write-actions-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const harness = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'mission-write-actions.sqlite')
});
const dbModule = await import('./db.ts');
const { createMission, createProject, generateMissionTitle } = await import('./repository.ts');
const { forgetMissionLatchSession } = await import('./execution/latch-sessions.ts');

const project = await createProject({ name: 'Write Actions' });
const mission = await createMission({ projectId: project.id, firstObjective: 'Name me' });

function withScopes<T>(scopeGrants: string[], fn: () => Promise<T>): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveTokenAuth({
      workspaceUserId: harness.operatorWorkspaceUserId,
      tokenId: 'read-only-token',
      scopeGrants
    });
    return fn();
  });
}

describe('mission write actions', () => {
  it('refuses title regeneration without mission:update', async () => {
    await withScopes(['mission:read', 'objective:read'], async () => {
      await assert.rejects(generateMissionTitle(mission.id), {
        status: 403,
        message: 'Permission denied: mission:update'
      });
    });
  });

  it('refuses forgetting a terminal session without session:attach', async () => {
    await withScopes(['mission:read', 'session:read'], async () => {
      await assert.rejects(
        forgetMissionLatchSession(mission.id, { providerSessionId: 'latch-session' }),
        { status: 403, message: 'Permission denied: session:attach' }
      );
    });
  });

  it('lets a caller with the write actions past authorization', async () => {
    await withScopes(['mission:*', 'objective:*', 'session:*'], async () => {
      await assert.rejects(forgetMissionLatchSession(mission.id, {}), {
        status: 400,
        message: 'providerSessionId is required'
      });
    });
  });
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
