import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CapabilityResult,
  InspectLatchSessionResult,
  OpenLatchSessionResult,
  StopLatchSessionResult
} from '../../../packages/core/service/local-target/types.ts';
import type { TerminalSessionDto } from '../../shared/contract.ts';

import { invokeLocalTarget, useLocalTargetCapabilityAvailable } from './local-target-client.ts';

export const latchSessionKey = (providerSessionId: string) =>
  ['latch-session', providerSessionId] as const;

async function requireLocalTargetResult<T>(result: CapabilityResult<T>): Promise<T> {
  if (result.ok) return result.value;
  throw new Error(result.message);
}

export function useLatchSessionInspection({
  session,
  enabled
}: {
  session: TerminalSessionDto;
  enabled: boolean;
}) {
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  return useQuery({
    queryKey: latchSessionKey(session.providerSessionId),
    queryFn: async () =>
      requireLocalTargetResult(
        await invokeLocalTarget<InspectLatchSessionResult>({
          capability: 'inspectLatchSession',
          input: {
            providerSessionId: session.providerSessionId,
            executable: session.executable
          }
        })
      ),
    enabled: enabled && localTargetAvailable,
    refetchInterval: 10_000,
    retry: false
  });
}

export function useOpenLatchSession(session: TerminalSessionDto) {
  return useMutation({
    mutationFn: async () =>
      requireLocalTargetResult(
        await invokeLocalTarget<OpenLatchSessionResult>({
          capability: 'openLatchSession',
          input: {
            providerSessionId: session.providerSessionId,
            executable: session.executable,
            viewerKind: session.viewerKind
          }
        })
      )
  });
}

export function useStopLatchSession(session: TerminalSessionDto) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      requireLocalTargetResult(
        await invokeLocalTarget<StopLatchSessionResult>({
          capability: 'stopLatchSession',
          input: {
            providerSessionId: session.providerSessionId,
            executable: session.executable
          }
        })
      ),
    onSuccess: result => {
      qc.setQueryData<InspectLatchSessionResult>(
        latchSessionKey(session.providerSessionId),
        current => ({
          providerSessionId: session.providerSessionId,
          name: current?.name ?? session.sessionName,
          state: result.state,
          exitCode: current?.exitCode ?? null,
          inspectedAt: new Date().toISOString()
        })
      );
    }
  });
}
