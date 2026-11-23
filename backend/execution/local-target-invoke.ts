import type { SqlDialect } from '@overlord/database';

import {
  invokeLocalTargetCapability,
  type LocalTargetBridgeCall
} from '../../packages/core/service/local-target/desktop-bridge.ts';
import { InProcessProvider } from '../../packages/core/service/local-target/in-process-provider.ts';
import { isCoLocatedBackend } from '../../packages/core/service/local-target/resource-status.ts';
import { fail } from '../../packages/core/service/local-target/result.ts';
import type { CapabilityResult } from '../../packages/core/service/local-target/types.ts';
import { resolveManagedWorktreeRoot } from '../../packages/core/service/local-target/worktree-git.ts';

import { isDevInProcessLocalTargetEnabled } from './local-target-capability.ts';

function withServerDefaults(call: LocalTargetBridgeCall): LocalTargetBridgeCall {
  if (call.capability !== 'listWorktrees') return call;
  const worktreeRoot = call.input.worktreeRoot?.trim()
    ? call.input.worktreeRoot
    : resolveManagedWorktreeRoot();
  return { ...call, input: { ...call.input, worktreeRoot } };
}

function backendTargetMetadata() {
  return {
    executionTargetId: null,
    deviceLabel: null,
    transport: 'in_process' as const
  };
}

/**
 * Dev-only in-process local-target proxy for browser + loopback SQLite.
 * Hosted Postgres backends reject these calls with LOCAL_TARGET_REQUIRED.
 */
export async function invokeLocalTargetOnServer({
  dialect,
  call
}: {
  dialect: SqlDialect;
  call: LocalTargetBridgeCall;
}): Promise<CapabilityResult<unknown>> {
  if (!isCoLocatedBackend(dialect) || !isDevInProcessLocalTargetEnabled()) {
    return fail(
      backendTargetMetadata(),
      'LOCAL_TARGET_REQUIRED',
      'Checkout-local capabilities must run on a local execution target (Overlord Desktop or the dev invoke proxy).'
    );
  }

  const provider = new InProcessProvider(backendTargetMetadata());
  return invokeLocalTargetCapability({ provider, call: withServerDefaults(call) });
}
