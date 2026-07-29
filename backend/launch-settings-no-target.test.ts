import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * Contract v38: reading launch settings is a read. It reports the acting
 * machine's declared execution target or `null`, and never declares one.
 */
describe('launch settings without a declared execution target', () => {
  it('reports a null target instead of provisioning one, then reports it once declared', async () => {
    const dir = mkdtempSync(path.join('/tmp', 'ovld-launch-no-target-'));
    const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
    await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });
    const { getLaunchSettings } = await import('./execution/launch.ts');
    const { requireDatabaseClient } = await import('./db.ts');

    const db = requireDatabaseClient();
    const liveTargets = async (): Promise<number> => {
      const row = (await db.get(
        `SELECT COUNT(*) AS c FROM execution_targets WHERE deleted_at IS NULL`
      )) as { c: number } | undefined;
      return Number(row?.c ?? 0);
    };

    assert.equal(await liveTargets(), 0, 'a fresh workspace declares no execution target');

    const settings = await getLaunchSettings();
    assert.equal(settings.executionTargetId, null);
    assert.equal(settings.deviceLabel, null);
    // The read still returns usable defaults for the rest of the surface.
    assert.deepEqual(settings.agentConfigs, {});
    assert.ok(settings.terminalProfile);
    assert.equal(await liveTargets(), 0, 'reading launch settings must not declare a target');

    // The declaration path still works, and the read then reports it.
    const { runProtocolSubcommand } = await import('./protocol.ts');
    const declared = (await runProtocolSubcommand('register-target', {
      flags: { '--name': 'Declared Machine' }
    })) as { status: string; executionTarget: { executionTargetId: string; label: string } };
    assert.equal(declared.status, 'registered');

    const afterDeclaration = await getLaunchSettings();
    assert.equal(afterDeclaration.executionTargetId, declared.executionTarget.executionTargetId);
    // `deviceLabel` stays the machine's own label; `--name` names the target row.
    assert.ok(afterDeclaration.deviceLabel);
    assert.equal(await liveTargets(), 1);
  });
});
