/**
 * Latch capability discovery for the settings surface (coo:702).
 *
 * The probe must run on the device where the agent process will run, so it goes
 * through the local-target capability boundary rather than being answered by
 * the browser or the hosted backend. When no local transport can serve this
 * machine, the UI must say so honestly instead of guessing — direct execution
 * stays selectable either way.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DiscoverLatchResult } from '../../../packages/core/service/local-target/types.ts';

import { invokeLocalTarget, useLocalTargetCapabilityAvailable } from './local-target-client.ts';

export type { DiscoverLatchResult };

/** Discovery could not run from here (remote target, no desktop bridge, …). */
export type LatchDiscoveryUnavailable = {
  state: 'unavailable';
  code: string;
  message: string;
};

export type LatchDiscoveryView = DiscoverLatchResult | LatchDiscoveryUnavailable;

export const latchDiscoveryKey = (executionTargetId: string | null, executable: string) =>
  ['latch-discovery', executionTargetId ?? 'unknown', executable] as const;

export async function probeLatchDiscovery({
  executionTargetId,
  executable,
  force = false
}: {
  executionTargetId: string | null;
  executable: string;
  force?: boolean;
}): Promise<LatchDiscoveryView> {
  const result = await invokeLocalTarget<DiscoverLatchResult>({
    capability: 'discoverLatch',
    input: { executable, executionTargetId, force }
  });
  if (result.ok) return result.value;
  return { state: 'unavailable', code: result.code, message: result.message };
}

/**
 * Read discovery for one execution target. Cached in the query client because
 * this is consulted on every settings render; the underlying provider keeps its
 * own on-disk cache with cheap revalidation, so a refetch is not a full probe.
 */
export function useLatchDiscovery({
  executionTargetId,
  executable,
  enabled = true
}: {
  executionTargetId: string | null;
  executable: string;
  enabled?: boolean;
}) {
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  return useQuery({
    queryKey: latchDiscoveryKey(executionTargetId, executable),
    queryFn: () => probeLatchDiscovery({ executionTargetId, executable }),
    enabled: enabled && localTargetAvailable,
    staleTime: 60_000
  });
}

/** Force a re-probe, bypassing the provider's cache (the "Check again" action). */
export function useRecheckLatchDiscovery({
  executionTargetId,
  executable
}: {
  executionTargetId: string | null;
  executable: string;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => probeLatchDiscovery({ executionTargetId, executable, force: true }),
    onSuccess: data => qc.setQueryData(latchDiscoveryKey(executionTargetId, executable), data)
  });
}
