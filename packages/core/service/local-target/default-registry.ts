// Default provider registration for the local-target capability resolver (WS-A/C).
// Callers pass the caller's execution target id; the registry picks in-process vs
// runner-queue vs unavailable from the target ref alone.

import { InProcessProvider } from './in-process-provider.ts';
import {
  type ExecutionTargetRef,
  LocalTargetProviderRegistry,
  targetMetadata,
  UnavailableProvider
} from './registry.ts';
import { type RunnerQueueContext, RunnerQueueProvider } from './runner-queue-provider.ts';

export type DefaultLocalTargetRegistryOptions = {
  /** The execution target id for the device running this service-layer call, if known. */
  callerExecutionTargetId?: string | null;
  /**
   * What the runner-queue transport needs to write and await a job. Callers
   * that have a `ServiceContext` (every backend route) should pass it; without
   * it there is no way to reach another device, and those targets resolve to a
   * typed unavailable provider instead.
   */
  runnerQueue?: RunnerQueueContext | null;
};

/**
 * Build a registry with the standard transport priority:
 * 1. In-process only when the target is the caller device's execution target.
 * 2. Runner queue for other reachable local targets (including a co-located
 *    backend driving a different device's checkout — queue-here / run-there).
 * 3. Unavailable for everything else (unreachable targets, unsupported types).
 */
export function createDefaultLocalTargetRegistry({
  callerExecutionTargetId = null,
  runnerQueue = null
}: DefaultLocalTargetRegistryOptions): LocalTargetProviderRegistry {
  const registry = new LocalTargetProviderRegistry();

  registry.register(target => {
    if (target.type !== 'local' || !target.executionTargetId) return null;
    const isCallerTarget =
      callerExecutionTargetId !== null && target.executionTargetId === callerExecutionTargetId;
    if (isCallerTarget) {
      return new InProcessProvider(targetMetadata(target, 'in_process'));
    }
    if (target.reachable === false) {
      return new UnavailableProvider(
        targetMetadata(target, 'fake'),
        'LOCAL_TARGET_UNREACHABLE',
        'The selected execution target is offline. Start a runner on that device or choose another target.'
      );
    }
    if (!runnerQueue) {
      // No service context, so no queue to write to. Say that plainly rather
      // than handing back a provider that would fail on first use.
      return new UnavailableProvider(
        targetMetadata(target, 'fake'),
        'LOCAL_TARGET_UNREACHABLE',
        'Reaching another execution target needs the runner queue, which this caller cannot write to.'
      );
    }
    return new RunnerQueueProvider(targetMetadata(target, 'runner_queue'), runnerQueue);
  });

  return registry;
}

export function resolveDefaultLocalTargetProvider({
  target,
  options
}: {
  target: ExecutionTargetRef;
  options: DefaultLocalTargetRegistryOptions;
}): ReturnType<LocalTargetProviderRegistry['resolveOrUnavailable']> {
  return createDefaultLocalTargetRegistry(options).resolveOrUnavailable(target);
}
