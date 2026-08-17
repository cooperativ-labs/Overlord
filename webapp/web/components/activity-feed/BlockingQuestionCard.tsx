import { CircleHelp } from 'lucide-react';

import type { ActivityFeedQuestionItemDto } from '../../../shared/contract.ts';
import { agentDisplayName } from '../../lib/helpers/agent-icons.ts';
import { AgentIcon } from '../objectives/AgentIcon.tsx';
import { Button } from '../ui.tsx';

import { relativeTime } from './activity-feed-model.ts';
import { ActivityFeedCardMeta, KindBadge } from './ActivityFeedCardChrome.tsx';

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
  onOpenMission: (missionId: string) => void;
}) {
  const agentKey = item.agentIdentifier;

  return (
    <article className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/50 dark:bg-amber-500/10">
      <ActivityFeedCardMeta
        item={item}
        trailing={<span>{relativeTime(item.askedAt, nowIso)}</span>}
      />

      <KindBadge
        tone="question"
        icon={<CircleHelp className="size-3" aria-hidden="true" />}
        label="blocking question"
      />

      <p className="wrap-anywhere text-sm text-amber-950 dark:text-amber-100">{item.question}</p>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-amber-900 dark:text-amber-200">
        {agentKey ? (
          <span className="inline-flex items-center gap-1.5">
            <AgentIcon agentKey={agentKey} size={12} />
            <span>{agentDisplayName(agentKey)}</span>
          </span>
        ) : null}
        <span>Blocked until answered</span>
        <Button type="button" className="ml-auto" onClick={() => onOpenMission(item.missionId)}>
          Answer
        </Button>
      </div>
    </article>
  );
}
