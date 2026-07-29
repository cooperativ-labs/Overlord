import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * Contract v39: onboarding is intentional. Configuring launch settings never
 * declares an execution target, and the workspace registration route is the
 * desktop's explicit equivalent of `ovld add-et`.
 */
describe('intentional execution-target onboarding', () => {
  it('refuses launch-settings writes without a target, then accepts them once declared', async () => {
    const dir = mkdtempSync(path.join('/tmp', 'ovld-onboarding-launch-'));
    const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
    const { WORKSPACE } = await bootstrapIntegrationTestDb({
      sqlitePath: path.join(dir, 'Overlord.sqlite')
    });
    const { updateAgentLaunchConfig, updateTerminalProfile } =
      await import('./execution/launch.ts');
    const { registerWorkspaceExecutionTarget } =
      await import('./execution/project-execution-target.ts');
    const { requireDatabaseClient } = await import('./db.ts');

    const db = requireDatabaseClient();
    const liveTargets = async (): Promise<number> => {
      const row = (await db.get(
        `SELECT COUNT(*) AS c FROM execution_targets WHERE deleted_at IS NULL`
      )) as { c: number } | undefined;
      return Number(row?.c ?? 0);
    };

    const expectNoTarget = (error: unknown): boolean =>
      error instanceof Error &&
      /no execution target is registered/i.test(error.message) &&
      /ovld add-et/.test(error.message);

    await assert.rejects(
      () =>
        updateTerminalProfile({
          launcher: 'Terminal',
          placement: 'window',
          chord: null,
          background: false
        }),
      expectNoTarget
    );
    await assert.rejects(
      () => updateAgentLaunchConfig('claude-code', { preCommand: 'nvm use 22' }),
      expectNoTarget
    );
    assert.equal(await liveTargets(), 0, 'a settings write is not an onboarding trigger');

    // The explicit declaration is the only thing that changes this.
    const registered = await registerWorkspaceExecutionTarget(WORKSPACE.id, {
      label: 'Jake MBP'
    });
    assert.equal(registered.label, 'Jake MBP');
    assert.equal(await liveTargets(), 1);

    const saved = await updateTerminalProfile({
      launcher: 'Terminal',
      placement: 'window',
      chord: null,
      background: false
    });
    assert.equal(saved.executionTargetId, registered.id);
    assert.equal(saved.terminalProfile.launcher, 'Terminal');
    assert.equal(await liveTargets(), 1, 'declaring is idempotent across later writes');

    // Re-registering the same machine renames rather than adding a second target.
    const again = await registerWorkspaceExecutionTarget(WORKSPACE.id, { label: 'Renamed' });
    assert.equal(again.id, registered.id);
    assert.equal(again.label, 'Renamed');
    assert.equal(await liveTargets(), 1);
  });
});
