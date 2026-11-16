import type { HumanAgentRequestDto } from '@overlord/contract';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  answerNeedsFollowUp,
  answerOutcome,
  newerAnswerSnapshot
} from '../components/agent-session/question-answer-model.ts';

import { useMissionAgentRequests } from './queries.ts';

/**
 * Answers a person recorded, kept on screen until their delivery is settled (ADR 0065).
 *
 * The mission panel and objective detail list open requests. Recording an answer resolves the
 * request, so it leaves that list on the next read, and with it the only place its delivery
 * outcome was shown. This store and {@link useAnswerFollowUps} keep a resolved question visible
 * where it was answered:
 *
 * - while its answer is on its way, failed or unconfirmed (any client, any device: the state
 *   comes from the server's all-status read, which realtime `agent_request` changes refresh);
 * - after a confirmed delivery, only on the device that answered, until the person closes it.
 *
 * Closing a follow-up hides it for this page session only. It never changes the request.
 */

type Entry = {
  /** The latest copy this device has: the resolve or redeliver response. */
  request: HumanAgentRequestDto;
};

const answered = new Map<string, Map<string, Entry>>();
const closed = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getVersion = () => version;

/** Record the authoritative request a resolve or redeliver call returned on this device. */
export function noteAnsweredAgentRequest(request: HumanAgentRequestDto) {
  if (!request.missionId) return;
  const forMission = answered.get(request.missionId) ?? new Map<string, Entry>();
  forMission.set(request.id, { request });
  answered.set(request.missionId, forMission);
  // A new outcome is news: show it again even if an earlier one was closed.
  const hidden = closed.get(request.missionId);
  if (hidden?.has(request.id)) {
    closed.set(request.missionId, new Set([...hidden].filter(id => id !== request.id)));
  }
  emit();
}

export function closeAnswerFollowUp(missionId: string, requestId: string) {
  const hidden = closed.get(missionId) ?? new Set<string>();
  if (hidden.has(requestId)) return;
  closed.set(missionId, new Set([...hidden, requestId]));
  emit();
}

/** Test hook. */
export function resetAnsweredAgentRequestsForTests() {
  answered.clear();
  closed.clear();
  emit();
}

/**
 * Pure selection, exported for tests. `serverRequests` is the all-status read; `local` holds
 * this device's answers; `closedIds` the follow-ups closed in this session.
 */
export function selectAnswerFollowUps({
  serverRequests,
  local,
  closedIds,
  objectiveId
}: {
  serverRequests: readonly HumanAgentRequestDto[];
  local: ReadonlyMap<string, Entry> | undefined;
  closedIds: ReadonlySet<string> | undefined;
  objectiveId?: string | null;
}): HumanAgentRequestDto[] {
  const byId = new Map<string, HumanAgentRequestDto>();
  for (const request of serverRequests) byId.set(request.id, request);
  for (const [id, entry] of local ?? []) {
    const server = byId.get(id);
    byId.set(id, server ? newerAnswerSnapshot(entry.request, server) : entry.request);
  }
  return [...byId.values()]
    .filter(request => !objectiveId || request.objectiveId === objectiveId)
    .filter(request => !closedIds?.has(request.id))
    .filter(request => {
      if (!answerOutcome(request)) return false;
      return answerNeedsFollowUp(request) || (local?.has(request.id) ?? false);
    })
    .sort((a, b) => ((a.resolvedAt ?? a.createdAt) < (b.resolvedAt ?? b.createdAt) ? -1 : 1));
}

/**
 * Resolved questions/choices of a mission (or one objective) whose answer is not yet settled,
 * plus this device's recent answers, oldest answer first.
 */
export function useAnswerFollowUps(missionId: string, objectiveId?: string | null) {
  const requestsQ = useMissionAgentRequests(missionId, undefined, Boolean(missionId));
  const storeVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  const followUps = useMemo(
    () =>
      selectAnswerFollowUps({
        serverRequests: requestsQ.data ?? [],
        local: answered.get(missionId),
        closedIds: closed.get(missionId),
        objectiveId
      }),
    // storeVersion re-runs the selection when this device answers or closes a follow-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missionId, objectiveId, requestsQ.data, storeVersion]
  );
  const close = useCallback(
    (requestId: string) => closeAnswerFollowUp(missionId, requestId),
    [missionId]
  );
  return { followUps, close };
}
