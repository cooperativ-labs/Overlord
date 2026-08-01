import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { callerDeviceFingerprint } from './devices.js';
import { ServiceError } from './errors.js';
import {
  backendHostFingerprint,
  ensureCallerDeviceTarget,
  findActingDeviceExecutionTargetId,
  findActingDeviceTarget,
  NO_EXECUTION_TARGET_REGISTERED,
  resolveClaimingDeviceTarget
} from './execution-targets.js';
import { addProjectResource, createProject, discoverProject } from './projects.js';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.js';

/**
 * Contract v38: an execution target exists only because someone declared it.
 * These tests pin the two halves of that rule — read/protocol/runner paths never
 * create one, and the declaration paths still do.
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
 * advertised dialect changes, which is exactly what `isCoLocatedBackend` reads —
 * so the hosted branch is exercised without a live Postgres.
 */
function asHostedCtx(ctx: ServiceContext, clientDevice: ServiceContext['clientDevice']) {
  return {
    ...ctx,
    db: new Proxy(ctx.db, {
      get(inner, prop, receiver) {
        if (prop === 'dialect') return 'postgres';
        return Reflect.get(inner, prop, receiver);
      }
    }) as DatabaseClient,
    clientDevice
  } satisfies ServiceContext;
}

describe('execution targets are declared, never inferred (contract v38)', () => {
  it('returns null and writes nothing when the acting machine was never declared', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const before = await countIdentityRows(db);

    assert.equal(await findActingDeviceTarget({ ctx }), null);
    assert.equal(await findActingDeviceExecutionTargetId({ ctx }), null);

    assert.deepEqual(await countIdentityRows(db), before);
    await db.close();
  });

  it('resolves the declared target once a declaration path has created it', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const declared = await ensureCallerDeviceTarget({ ctx });

    const found = await findActingDeviceTarget({ ctx });
    assert.ok(found);
    assert.equal(found.executionTargetId, declared.executionTargetId);
    assert.equal(found.deviceId, declared.deviceId);
    assert.equal(found.targetFingerprint, callerDeviceFingerprint());
    assert.equal(found.preferenceId, declared.preferenceId);
    assert.equal(await findActingDeviceExecutionTargetId({ ctx }), declared.executionTargetId);

    await db.close();
  });

  it('fails a runner claim with an actionable code instead of provisioning a target', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const before = await countIdentityRows(db);

    await assert.rejects(
      () => resolveClaimingDeviceTarget({ ctx }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === NO_EXECUTION_TARGET_REGISTERED &&
        error.status === 409 &&
        /ovld add-et/.test(error.message)
    );

    assert.deepEqual(await countIdentityRows(db), before);
    await db.close();
  });

  it('claims against the declared target once the machine is registered', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const declared = await ensureCallerDeviceTarget({ ctx });

    const claiming = await resolveClaimingDeviceTarget({ ctx });
    assert.equal(claiming.executionTargetId, declared.executionTargetId);
    assert.equal(claiming.deviceId, declared.deviceId);

    await db.close();
  });

  it('ignores a browser device hint on a hosted backend and writes nothing', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const before = await countIdentityRows(db);
    const hosted = asHostedCtx(ctx, {
      deviceFingerprint: 'browser-localstorage-pseudo-fingerprint',
      deviceLabel: 'browser',
      devicePlatform: 'browser'
    });

    assert.equal(await findActingDeviceTarget({ ctx: hosted }), null);
    assert.equal(await findActingDeviceExecutionTargetId({ ctx: hosted }), null);

    assert.deepEqual(await countIdentityRows(db), before);
    await db.close();
  });

  it('ignores the hosted backend host fingerprint and a missing hint', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });

    const backendHost = asHostedCtx(ctx, {
      deviceFingerprint: backendHostFingerprint(),
      deviceLabel: 'railway',
      devicePlatform: 'linux'
    });
    assert.equal(await findActingDeviceTarget({ ctx: backendHost }), null);

    const noHint = asHostedCtx(ctx, null);
    assert.equal(await findActingDeviceTarget({ ctx: noHint }), null);
    assert.equal(await findActingDeviceExecutionTargetId({ ctx: noHint }), null);

    await assert.rejects(
      () => resolveClaimingDeviceTarget({ ctx: noHint }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === NO_EXECUTION_TARGET_REGISTERED
    );

    await db.close();
  });

  it('does not declare a target while discovering a project', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Discovery without declaration' });
    const before = await countIdentityRows(db);

    const discovered = await discoverProject({ ctx, projectId: project.id });
    assert.equal(discovered.projectId, project.id);

    // Directory-walk discovery also reads the acting target rather than minting one.
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'ovld-discovery-'));
    await discoverProject({ ctx, workingDirectory: emptyDir }).catch(() => null);

    assert.deepEqual(await countIdentityRows(db), before);
    await db.close();
  });

  it('still declares the machine when a checkout is linked from it', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Linked checkout declares' });
    assert.equal(await findActingDeviceTarget({ ctx }), null);

    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-linked-checkout-'),
      isPrimary: true
    });

    const declared = await findActingDeviceTarget({ ctx });
    assert.ok(declared, 'linking a checkout from this machine declares its execution target');

    const source = (await db.get(
      `SELECT execution_target_id FROM project_resource_sources
        WHERE project_id = ? AND deleted_at IS NULL`,
      [project.id]
    )) as { execution_target_id: string | null } | undefined;
    assert.equal(source?.execution_target_id, declared.executionTargetId);

    await db.close();
  });
});
