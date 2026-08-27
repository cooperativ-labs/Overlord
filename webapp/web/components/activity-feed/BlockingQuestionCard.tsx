import { CircleHelp } from 'lucide-react';

import type { ActivityFeedQuestionItemDto } from '../../../shared/contract.ts';
import { useMissionAgentRequests } from '../../lib/queries.ts';
import { QuestionAnswerForm } from '../agent-session/QuestionAnswerForm.tsx';
import { Button } from '../ui.tsx';

import { relativeTime } from './activity-feed-model.ts';
import {
  ActivityFeedAgentLine,
  ActivityFeedCardMeta,
  ActivityFeedOriginCorner,
  KindBadge
} from './ActivityFeedCardChrome.tsx';

/**
 * An agent blocked on a question. Contract v129 links an ask to an agent request,
 * allowing the feed to use the exact same Latch-gated answer form as mission detail.
 */
export function BlockingQuestionCard({
  item,
  nowIso,
  onOpenMission
}: {
  item: ActivityFeedQuestionItemDto;
  nowIso: string;
  onOpenMission: (args: { missionId: string; objectiveDisplayId?: string | null }) => void;
}) {
  const requestsQ = useMissionAgentRequests(item.missionId, item.objectiveId ?? undefined);
  const request = item.agentRequestId
    ? (requestsQ.data ?? []).find(candidate => candidate.id === item.agentRequestId)
    : null;

  return (
    <article className="relative grid shrink-0 gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 pr-8 transition-shadow hover:shadow-lg dark:border-amber-500/50 dark:bg-amber-500/10">
      <ActivityFeedOriginCorner
        createdByKind={item.createdByKind}
        createdByAgent={item.createdByAgent}
      />
      <ActivityFeedCardMeta
        item={item}
        trailing={<span>{relativeTime(item.askedAt, nowIso)}</span>}
      />

      <KindBadge
        tone="question"
        icon={<CircleHelp className="size-3" aria-hidden="true" />}
        label="blocking question"
      />

      <p className="wrap-anywhere text-base text-amber-950 dark:text-amber-100">{item.question}</p>

      {item.agentRequestId ? (
        request ? (
          <QuestionAnswerForm request={request} />
        ) : requestsQ.isLoading ? (
          <p className="text-[11px] text-amber-900 dark:text-amber-200">Loading reply controls…</p>
        ) : (
          <p className="text-[11px] text-amber-900 dark:text-amber-200">
            This question is no longer available to answer.
          </p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs text-amber-900 dark:text-amber-200">
        <ActivityFeedAgentLine agentKey={item.agentIdentifier} />
        <span>Blocked until answered</span>
        {!item.agentRequestId ? (
          <Button
            type="button"
            className="ml-auto"
            onClick={() =>
              onOpenMission({
                missionId: item.missionId,
                objectiveDisplayId: item.objectiveDisplayId
              })
            }
          >
            View question
          </Button>
        ) : null}
      </div>
    </article>
  );
}
