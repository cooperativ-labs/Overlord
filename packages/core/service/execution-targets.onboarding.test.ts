import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';
import {
  backendHostFingerprint,
  declareActingDeviceTarget,
  findActingDeviceTarget,
  hasMachineLocalIdentity,
  NO_EXECUTION_TARGET_REGISTERED,
  updateTerminalProfile
} from './execution-targets.js';
import { registerActingExecutionTarget } from './project-execution-target.js';
import { addProjectResource, createProject } from './projects.js';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.js';

/**
 * Contract v39: onboarding follows intent, not capability. Only `register-target`
 * and an *eligible machine-local* checkout link may declare an execution target,
 * and a caller with no machine identity is refused rather than inferred.
 */

type Counts = { devices: number; targets: number; access: number; preferences: number };

async function countIdentityRows(db: DatabaseClient): Promise<Counts> {
  const one = async (sql: string): Promise<number> => {
    const row = (await db.get(sql)) as { c: number } | undefined;
    return Number(row?.c ?? 0);
  };
  return {
    devices: await one(`SELECT COUNT(*) AS c FROM devices WHERE deleted_at IS NULL`),
    targets: await one(`SELECT COUNT(*) AS c FROM execution_targets WHERE deleted_at IS NULL`),
    access: await one(
      `SELECT COUNT(*) AS c FROM workspace_user_execution_targets WHERE deleted_at IS NULL`
    ),
    preferences: await one(
      `SELECT COUNT(*) AS c FROM user_execution_target_preferences WHERE deleted_at IS NULL`
    )
  };
}

/**
 * A hosted (non-co-located) backend view over the same SQLite database. Only the
 * advertised dialect changes, which is what `isCoLocatedBackend` reads — so the
 * hosted branch is exercised without a live Postgres.
 */
function asHostedCtx(ctx: ServiceContext, clientDevice: ServiceContext['clientDevice']) {
  return {
    ...ctx,
    db: new Proxy(ctx.db, {
      get(inner, prop) {
        if (prop === 'dialect') return 'postgres';
        // Bind through to the real client: its methods read private fields, which
        // a proxy receiver cannot satisfy.
        const value = Reflect.get(inner, prop, inner) as unknown;
        return typeof value === 'function' ? value.bind(inner) : value;
      }
    }) as DatabaseClient,
    clientDevice
  } satisfies ServiceContext;
}

function isNoTarget(error: unknown): boolean {
  return (
    error instanceof ServiceError &&
    error.code === NO_EXECUTION_TARGET_REGISTERED &&
    error.status === 409 &&
    /ovld add-et/.test(error.message)
  );
}

describe('only intentional acts declare an execution target (contract v39)', () => {
  it('treats a real machine hint as eligible and browser/backend-host/absent hints as not', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });

    // The co-located Local backend *is* the machine.
    assert.equal(hasMachineLocalIdentity(ctx), true);

    assert.equal(
      hasMachineLocalIdentity(
        asHostedCtx(ctx, {
          deviceFingerprint: 'real-machine-fingerprint',
          deviceLabel: 'Jake MBP',
          devicePlatform: 'darwin'
        })
      ),
      true
    );
    assert.equal(
      hasMachineLocalIdentity(
        asHostedCtx(ctx, {
          deviceFingerprint: 'browser-localstorage-pseudo-fingerprint',
          deviceLabel: 'browser',
          devicePlatform: 'browser'
        })
      ),
      false
    );
    assert.equal(
      hasMachineLocalIdentity(
        asHostedCtx(ctx, {
          deviceFingerprint: backendHostFingerprint(),
          deviceLabel: 'railway',
          devicePlatform: 'linux'
        })
      ),
      false
    );
    assert.equal(hasMachineLocalIdentity(asHostedCtx(ctx, null)), false);

    await db.close();
  });

  it('refuses to declare a target for a caller with no machine identity, and writes nothing', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const before = await countIdentityRows(db);
    const browser = asHostedCtx(ctx, {
      deviceFingerprint: 'browser-localstorage-pseudo-fingerprint',
      deviceLabel: 'browser',
      devicePlatform: 'browser'
    });
    const noHint = asHostedCtx(ctx, null);

    for (const caller of [browser, noHint]) {
      for (const declaration of ['register_target', 'local_checkout_link'] as const) {
        await assert.rejects(
          () => declareActingDeviceTarget({ ctx: caller, declaration }),
          isNoTarget
        );
      }
    }

    assert.deepEqual(await countIdentityRows(db), before);
    await db.close();
  });

  it('refuses a browser checkout link without an explicit target instead of declaring one', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const project = await createProject({ ctx, name: 'Browser link refused' });
    const before = await countIdentityRows(db);
    const browser = asHostedCtx(ctx, {
      deviceFingerprint: 'browser-localstorage-pseudo-fingerprint',
      deviceLabel: 'browser',
      devicePlatform: 'browser'
    });

    await assert.rejects(
      () =>
        addProjectResource({
          ctx: browser,
          projectId: project.id,
          directoryPath: createIsolatedCheckout('ovld-browser-link-'),
          isPrimary: true
        }),
      isNoTarget
    );

    assert.deepEqual(await countIdentityRows(db), before);
    const sources = (await db.get(
      `SELECT COUNT(*) AS c FROM project_resource_sources WHERE deleted_at IS NULL`
    )) as { c: number } | undefined;
    assert.equal(Number(sources?.c ?? 0), 0, 'a refused link writes no source either');

    await db.close();
  });

  it('declares idempotently through register-target and renames rather than duplicating', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    assert.equal(await findActingDeviceTarget({ ctx }), null);

    const first = await registerActingExecutionTarget({ ctx, label: 'Jake MBP' });
    const second = await registerActingExecutionTarget({ ctx, label: 'Jake MBP (renamed)' });

    assert.equal(second.executionTargetId, first.executionTargetId);
    assert.equal(second.label, 'Jake MBP (renamed)');
    const counts = await countIdentityRows(db);
    assert.equal(counts.devices, 1);
    assert.equal(counts.targets, 1);

    await db.close();
  });

  it('refuses a launch-preference write on an undeclared machine, then accepts it once declared', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const before = await countIdentityRows(db);
    const profile = { launcher: 'Terminal', placement: 'window' as const, chord: null };

    await assert.rejects(() => updateTerminalProfile({ ctx, profile }), isNoTarget);
    assert.deepEqual(
      await countIdentityRows(db),
      before,
      'configuring settings is not an onboarding trigger'
    );

    await registerActingExecutionTarget({ ctx, label: 'Declared' });
    const saved = await updateTerminalProfile({ ctx, profile });
    assert.equal(saved.terminalProfile.launcher, 'Terminal');

    await db.close();
  });
});
