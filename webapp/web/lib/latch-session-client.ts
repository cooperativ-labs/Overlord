import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CapabilityResult,
  CollectLatchEventsResult,
  InspectLatchSessionResult,
  OpenLatchSessionResult,
  ResolveLatchInputResult,
  StopLatchSessionResult
} from '../../../packages/core/service/local-target/types.ts';
import type { TerminalSessionDto } from '../../shared/contract.ts';

import { api } from './api.ts';
import { invokeLocalTarget, useLocalTargetCapabilityAvailable } from './local-target-client.ts';
import { keys } from './query-keys.ts';

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

export function useLatchHarnessEventIngest({
  session,
  missionId,
  enabled
}: {
  session: TerminalSessionDto;
  missionId: string;
  enabled: boolean;
}) {
  const qc = useQueryClient();
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  const from = session.observation?.cursor ?? 0;
  return useQuery({
    queryKey: ['latch-events', session.providerSessionId, from] as const,
    queryFn: async () => {
      const collected = await requireLocalTargetResult(
        await invokeLocalTarget<CollectLatchEventsResult>({
          capability: 'collectLatchEvents',
          input: {
            providerSessionId: session.providerSessionId,
            executable: session.executable,
            from
          }
        })
      );
      if (collected.events.length > 0) {
        await api.ingestMissionHarnessEvents(missionId, {
          providerSessionId: session.providerSessionId,
          events: collected.events,
          from: collected.from,
          executionRequestId: session.executionRequestId
        });
        await qc.invalidateQueries({ queryKey: keys.mission(missionId) });
      }
      return collected;
    },
    enabled: enabled && localTargetAvailable,
    refetchInterval: 10_000,
    retry: false
  });
}

export function useResolveLatchObservation(session: TerminalSessionDto, missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, choice }: { requestId: string; choice: string }) => {
      const resolved = await requireLocalTargetResult(
        await invokeLocalTarget<ResolveLatchInputResult>({
          capability: 'resolveLatchInput',
          input: {
            providerSessionId: session.providerSessionId,
            executable: session.executable,
            requestId,
            choice
          }
        })
      );
      await api.resolveMissionLatchObservation(missionId, {
        providerSessionId: session.providerSessionId,
        requestId
      });
      return resolved;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.mission(missionId) });
    }
  });
}
