import type { HumanAgentRequestDto, MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import { AlertTriangle, ChevronDown, RotateCw } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { useAnswerFollowUps } from '../../lib/answered-agent-requests.ts';
import { useDismissedAgentRequests } from '../../lib/dismissed-agent-requests.ts';
import type { useMissionOpenAgentRequests } from '../../lib/queries.ts';
import {
  AnsweredAgentRequestCard,
  DismissibleAgentRequestCard
} from '../objective-detail/AgentRequestCards.tsx';
import { isInFlightObjective } from '../objectives/ObjectiveRow.tsx';

/** Notifications shown before the "Show n more" disclosure (plan §5). */
export const BLOCKING_QUESTIONS_VISIBLE = 2;

type OpenRequests = ReturnType<typeof useMissionOpenAgentRequests>;

/**
 * Open blocking requests the mission-level slot notifies about: open question/choice requests,
 * oldest first, except those of an objective that is known and no longer in flight (the same
 * rule as the objective detail's top cards, so the two never disagree).
 */
export function missionNotificationRequests(
  blocking: readonly HumanAgentRequestDto[],
  objectives: readonly Pick<ObjectiveDto, 'id' | 'state'>[]
): HumanAgentRequestDto[] {
  const byId = new Map(objectives.map(objective => [objective.id, objective]));
  return blocking.filter(request => {
    const objective = request.objectiveId ? byId.get(request.objectiveId) : undefined;
    return !objective || isInFlightObjective(objective.state);
  });
}

/**
 * Blocking questions under the mission title (mission-panel-redesign plan §5): one existing
 * answer card per open, undismissed request, oldest first. Two show; more sit behind "Show n
 * more". Each card names its objective, which opens that objective's detail, and can be
 * dismissed. Dismissing hides only the notification (here and at the top of the objective
 * detail); the request stays open, tinted on its row and listed in For you and in the detail.
 *
 * After a person answers, the request leaves the open list; its answered card stays here while
 * the delivery is pending, failed or unconfirmed (and, on the answering device, once confirmed
 * until closed), so the outcome and any "Send again" stay where the answer was given.
 *
 * Renders nothing when no undismissed notification or answer follow-up remains. A failed refresh
 * keeps the last successful cards with a retry, rather than claiming the questions went away.
 */
export function MissionBlockingQuestions({
  mission,
  openRequests,
  onOpenObjective
}: {
  mission: MissionDetailDto;
  openRequests: OpenRequests;
  onOpenObjective: (objectiveRef: string, trigger: HTMLElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const moreId = useId();
  const { dismissedIds, dismiss } = useDismissedAgentRequests(
    { workspaceId: mission.workspaceId, missionId: mission.id },
    {
      openRequestIds: openRequests.requests.map(request => request.id),
      authoritative: openRequests.authoritative
    }
  );
  const objectivesById = useMemo(
    () => new Map(mission.objectives.map(objective => [objective.id, objective])),
    [mission.objectives]
  );
  const cards = useMemo(
    () =>
      missionNotificationRequests(openRequests.blocking, mission.objectives).filter(
        request => !dismissedIds.has(request.id)
      ),
    [dismissedIds, mission.objectives, openRequests.blocking]
  );

  const { followUps, close } = useAnswerFollowUps(mission.id);
  const answeredCards = useMemo(() => {
    const openIds = new Set(openRequests.requests.map(request => request.id));
    return missionNotificationRequests(followUps, mission.objectives).filter(
      request => !openIds.has(request.id)
    );
  }, [followUps, mission.objectives, openRequests.requests]);

  if (cards.length === 0 && answeredCards.length === 0) return null;
  const visible = expanded ? cards : cards.slice(0, BLOCKING_QUESTIONS_VISIBLE);
  const hiddenCount = cards.length - BLOCKING_QUESTIONS_VISIBLE;
  const objectiveHeader = (request: HumanAgentRequestDto, lead: string) => {
    const objective = request.objectiveId ? objectivesById.get(request.objectiveId) : null;
    const objectiveRef = objective ? objective.displayId || objective.id : null;
    if (!objectiveRef) return null;
    return (
      <div className="mb-1 flex min-w-0 items-center gap-2 text-xs text-(--color-ink-dim)">
        <span className="shrink-0">{lead}</span>
        <button
          type="button"
          aria-label={`Open objective ${objectiveRef}`}
          onClick={event => onOpenObjective(objectiveRef, event.currentTarget)}
          className="min-w-0 truncate rounded-sm font-mono hover:text-(--color-ink) hover:underline focus-visible:outline-2"
        >
          {objectiveRef}
        </button>
        {objective?.title?.trim() ? (
          <span className="min-w-0 truncate">{objective.title.trim()}</span>
        ) : null}
      </div>
    );
  };

  return (
    <section aria-label="Blocking questions" className="grid min-w-0 gap-2 px-5 pt-3">
      {openRequests.state === 'error' ? (
        <p
          role="alert"
          className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Could not refresh questions; showing the last ones loaded.
          </span>
          <button
            type="button"
            onClick={() => void openRequests.retry()}
            className="inline-flex items-center gap-1 rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2"
          >
            <RotateCw className="size-3" aria-hidden="true" />
            Retry
          </button>
        </p>
      ) : null}
      <div id={moreId} className="grid min-w-0 gap-2">
        {visible.map(request => (
          <DismissibleAgentRequestCard
            key={request.id}
            request={request}
            onDismiss={dismiss}
            header={objectiveHeader(request, 'Waiting on you in')}
          />
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={moreId}
          onClick={() => setExpanded(value => !value)}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-(--color-ink-dim) hover:text-(--color-ink) focus-visible:outline-2"
        >
          <ChevronDown className={expanded ? 'size-3 rotate-180' : 'size-3'} aria-hidden="true" />
          {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
        </button>
      ) : null}
      {answeredCards.map(request => (
        <AnsweredAgentRequestCard
          key={request.id}
          request={request}
          onClose={close}
          header={objectiveHeader(request, 'Answered in')}
        />
      ))}
    </section>
  );
}
