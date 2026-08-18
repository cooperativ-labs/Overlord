import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { chunkLatchHarnessEventsForIngest } from '../../../packages/core/service/latch-harness-ingest.ts';
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
    // The cursor deliberately stays out of the key. Keying on it minted a fresh
    // cache entry — holding a full collected-event payload — every time the
    // observation advanced, and a session polling every ten seconds kept a
    // gcTime's worth of those alive at once. The interval already refetches, and
    // each refetch runs the current render's `queryFn`, so a stable key reads the
    // latest cursor without accumulating entries. `gcTime: 0` drops the payload
    // as soon as nothing is subscribed rather than parking it for five minutes.
    queryKey: ['latch-events', session.providerSessionId] as const,
    gcTime: 0,
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
        const chunks = chunkLatchHarnessEventsForIngest({
          events: collected.events,
          from: collected.from
        });
        for (const chunk of chunks) {
          await api.ingestMissionHarnessEvents(missionId, {
            providerSessionId: session.providerSessionId,
            events: chunk.events,
            from: chunk.from,
            executionRequestId: session.executionRequestId
          });
        }
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
