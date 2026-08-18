import { CircleHelp } from 'lucide-react';

import type { ActivityFeedQuestionItemDto } from '../../../shared/contract.ts';
import { Button } from '../ui.tsx';

import { relativeTime } from './activity-feed-model.ts';
import {
  ActivityFeedAgentLine,
  ActivityFeedCardMeta,
  ActivityFeedOriginCorner,
  KindBadge
} from './ActivityFeedCardChrome.tsx';

/**
 * An agent blocked on a question. Answering happens in the mission panel — remote
 * request resolution is retired — so "Answer" opens the panel rather than
 * pretending the feed can take the answer.
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

      <div className="flex flex-wrap items-center gap-3 text-xs text-amber-900 dark:text-amber-200">
        <ActivityFeedAgentLine agentKey={item.agentIdentifier} />
        <span>Blocked until answered</span>
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
          Answer
        </Button>
      </div>
    </article>
  );
}
