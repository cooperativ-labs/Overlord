import { ChevronDown, Package } from 'lucide-react';
import { useState } from 'react';

import type { ActivityFeedDeliveryItemDto } from '../../../shared/contract.ts';
import { agentDisplayName } from '../../lib/helpers/agent-icons.ts';
import { cn } from '../../lib/utils.ts';
import {
  deliveryOneSentenceSummary,
  DeliveryPresentation,
  formatDeliveryTimestamp,
  useCollapseOnDismiss
} from '../DeliverySummaryCard.tsx';
import { AgentIcon } from '../objectives/AgentIcon.tsx';

import { relativeTime } from './activity-feed-model.ts';
import { ActivityFeedCardMeta, KindBadge } from './ActivityFeedCardChrome.tsx';

/**
 * A recent delivery in the feed. Expanding renders `DeliveryPresentation` — the
 * exact body the mission panel's delivery card uses — so a change to how a
 * delivery reads lands on both surfaces at once.
 */
export function DeliveryFeedCard({
  item,
  nowIso
}: {
  item: ActivityFeedDeliveryItemDto;
  nowIso: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useCollapseOnDismiss(expanded, () => setExpanded(false));
  const preview = deliveryOneSentenceSummary(item.delivery);
  const agentKey = item.delivery.agentIdentifier;

  return (
    <article
      ref={cardRef}
      className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-1)"
    >
      <button
        type="button"
        onClick={() => setExpanded(current => !current)}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-2 p-3 text-left transition-colors hover:bg-(--color-surface-2)"
      >
        <ActivityFeedCardMeta
          item={item}
          trailing={<span>{relativeTime(item.occurredAt, nowIso)}</span>}
        />

        <div className="flex min-w-0 items-center gap-2">
          <KindBadge
            tone="delivered"
            icon={<Package className="size-3" aria-hidden="true" />}
            label="delivered"
          />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-ink)">
            {item.objectiveTitle ?? 'Delivery'}
          </h3>
        </div>

        {expanded ? null : (
          <p className="line-clamp-2 wrap-anywhere text-sm text-(--color-ink-dim)">{preview}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-(--color-ink-dim)">
          {agentKey ? (
            <span className="inline-flex items-center gap-1.5">
              <AgentIcon agentKey={agentKey} size={12} />
              <span>{agentDisplayName(agentKey)}</span>
            </span>
          ) : null}
          <span>{formatDeliveryTimestamp(item.delivery.deliveredAt)}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-(--color-ink)">
            {expanded ? 'Collapse' : 'Expand'}
            <ChevronDown
              className={cn('size-3 transition-transform', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-(--color-border) p-3">
          <DeliveryPresentation delivery={item.delivery} summaryText={item.delivery.summary} />
        </div>
      ) : null}
    </article>
  );
}
