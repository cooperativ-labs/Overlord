// Runner-side execution of a queued local-target capability call.
//
// This is the far half of the runner-queue transport: `ovld runner` claims an
// `execution_requests` row carrying `{ kind, capability, input }`, calls here,
// and posts the returned `CapabilityResult` back to the control plane. Dispatch
// is generic over `CapabilityName` — the runner is a transport, not a per-
// capability switch — with one pre-hook where the control plane cannot know
// something the target can, and a closed allowlist so an unknown or excluded
// name never reaches a provider.

import { InProcessProvider } from './local-target/in-process-provider.ts';
import { targetMetadata } from './local-target/registry.ts';
import { fail } from './local-target/result.ts';
import type { CapabilityResult, TargetMetadata } from './local-target/types.ts';
import {
  isQueueableCapabilityName,
  type LocalTargetCapabilities,
  type PerformBranchActionInput,
  type QueueableCapabilityName
} from './local-target/types.ts';
import { worktreePathForBranch } from './local-target/worktree-git.ts';
import {
  type LocalTargetMutationPayload,
  parseLocalTargetMutation
} from './local-target-mutations.ts';

function runnerTargetMetadata(): TargetMetadata {
  return targetMetadata(
    { executionTargetId: 'runner', type: 'local', reachable: true },
    'in_process'
  );
}

function inProcessProvider(): LocalTargetCapabilities {
  return new InProcessProvider(runnerTargetMetadata());
}

/**
 * Per-capability input adjustments the control plane cannot make for itself.
 *
 * `performBranchAction` is the only one: the control plane predicts
 * `worktreePath` without filesystem access (it may not be co-located with the
 * checkout), so it always resolves to the canonical worktree-mode path even for
 * a branch-only mission checked out directly in the primary repo. This runner
 * *is* on the execution target with real git access, so it re-derives the actual
 * checkout location the same way the desktop bridge does for local execution,
 * falling back to the queued path when the branch isn't checked out anywhere yet.
 */
const INPUT_PRE_HOOKS: Partial<
  Record<QueueableCapabilityName, (input: Record<string, unknown>) => Record<string, unknown>>
> = {
  performBranchAction: input => {
    const branchInput = input as unknown as PerformBranchActionInput;
    return {
      ...input,
      worktreePath:
        worktreePathForBranch(branchInput.primaryRepoPath, branchInput.branchName) ??
        branchInput.worktreePath
    };
  }
};

export async function executeLocalTargetMutation({
  mutation,
  provider = inProcessProvider()
}: {
  mutation: LocalTargetMutationPayload;
  provider?: LocalTargetCapabilities;
}): Promise<CapabilityResult<unknown>> {
  const capability = mutation.capability;
  // `parseLocalTargetMutation` already rejects non-queueable names; re-checking
  // here keeps the guard next to the call that would execute it, so a caller
  // that builds a payload by hand still fails closed rather than invoking an
  // arbitrary property of the provider.
  if (!isQueueableCapabilityName(capability)) {
    return fail(
      provider.target,
      'LOCAL_TARGET_UNSUPPORTED',
      `The runner does not execute the capability "${String(capability)}".`
    );
  }
  const input = INPUT_PRE_HOOKS[capability]?.(mutation.input) ?? mutation.input;
  const method = provider[capability] as (
    args: Record<string, unknown>
  ) => Promise<CapabilityResult<unknown>>;
  return method.call(provider, input);
}

export function parseMutationFromMetadata(metadata: unknown): LocalTargetMutationPayload | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return parseLocalTargetMutation(metadata as Record<string, unknown>);
}
