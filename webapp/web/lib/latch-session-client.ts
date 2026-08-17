import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isLatchSessionAbsentMessage } from '../../../packages/core/service/latch-session-absent.ts';
import type {
  CapabilityFailure,
  CapabilityResult,
  CollectLatchEventsResult,
  InspectLatchSessionResult,
  LocalTargetErrorCode,
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

export class LocalTargetCapabilityError extends Error {
  readonly code: LocalTargetErrorCode;

  constructor(result: CapabilityFailure) {
    super(result.message);
    this.name = 'LocalTargetCapabilityError';
    this.code = result.code;
  }
}

export function isLatchSessionAbsentError(error: unknown): boolean {
  if (error instanceof LocalTargetCapabilityError && error.code === 'LATCH_SESSION_ABSENT') {
    return true;
  }
  return error instanceof Error && isLatchSessionAbsentMessage(error.message);
}

async function requireLocalTargetResult<T>(result: CapabilityResult<T>): Promise<T> {
  if (result.ok) return result.value;
  throw new LocalTargetCapabilityError(result);
}

const forgettingLatchSessions = new Set<string>();

function forgetLatchSessionKey({
  missionId,
  providerSessionId
}: {
  missionId: string;
  providerSessionId: string;
}): string {
  return `${missionId}:${providerSessionId}`;
}

/** Drop the stored mapping after Latch reports the session gone. Idempotent. */
export async function forgetAbsentLatchSession({
  missionId,
  session,
  queryClient
}: {
  missionId: string;
  session: TerminalSessionDto;
  queryClient: QueryClient;
}): Promise<void> {
  const key = forgetLatchSessionKey({
    missionId,
    providerSessionId: session.providerSessionId
  });
  if (forgettingLatchSessions.has(key)) return;
  forgettingLatchSessions.add(key);
  try {
    await api.forgetMissionLatchSession(missionId, {
      providerSessionId: session.providerSessionId,
      executionRequestId: session.executionRequestId
    });
    await queryClient.invalidateQueries({ queryKey: keys.mission(missionId) });
  } catch {
    forgettingLatchSessions.delete(key);
  }
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
            viewerKind: session.viewerKind,
            // The same window-or-tab preference the launch used, so re-opening
            // a session does not silently change its shape.
            openAs: session.viewerOpenAs ?? 'window'
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
