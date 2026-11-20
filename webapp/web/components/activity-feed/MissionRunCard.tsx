import type {
  ActivityFeedMissionItemDto,
  ActivityFeedMissionObjectiveDto
} from '@overlord/contract';
import { CheckCircle2, Clock, FolderOpen, GitBranch, ListOrdered, Rocket } from 'lucide-react';

import { formatAgentHarnessText } from '../../lib/agent-harness-text.ts';
import { cn } from '../../lib/utils.ts';
import { AgentIcon } from '../objectives/AgentIcon.tsx';
import { ObjectiveStateIcon } from '../objectives/ObjectiveStateIcon.tsx';
import { ExecutingShimmer, StatusSpinner } from '../StatusMotion.tsx';

import { elapsedLabel, isInFlightObjectiveState, relativeTime } from './activity-feed-model.ts';
import {
  ActivityFeedAgentLine,
  ActivityFeedCardMeta,
  ActivityFeedOriginCorner,
  KindBadge
} from './ActivityFeedCardChrome.tsx';

/**
 * One objective under a mission card. Live work carries the same emerald
 * shimmer sweep the mission panel uses, so which step is running is visible
 * without reading a single word. A blocked objective (open question or choice)
 * swaps the shimmer for a solid yellow highlight. The row is a button that opens
 * the mission panel with this objective's detail (plan §9.1).
 */
function MissionObjectiveRow({
  objective,
  onOpen
}: {
  objective: ActivityFeedMissionObjectiveDto;
  onOpen: () => void;
}) {
  const blocked = objective.blocked === true;
  const inFlight = isInFlightObjectiveState(objective.state);
  const title = objective.title ?? 'Untitled objective';

  return (
    <li
      className={cn(
        'relative overflow-hidden rounded-md',
        blocked && 'bg-yellow-300/60 dark:bg-yellow-400/25'
      )}
    >
      {inFlight && !blocked ? <ExecutingShimmer /> : null}
      <button
        type="button"
        aria-label={blocked ? `${title} (blocked: waiting on an answer)` : title}
        onClick={onOpen}
        className="relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs outline-none hover:bg-(--color-surface-1)/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <ObjectiveStateIcon state={objective.state} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            objective.state === 'complete' ? 'text-(--color-ink-dim)' : 'text-(--color-ink)',
            inFlight && 'font-medium'
          )}
        >
          {title}
        </span>
        {objective.autoAdvance ? (
          <ListOrdered className="size-3 shrink-0 text-(--color-ink-dim)" aria-label="Queued" />
        ) : null}
        <span className="shrink-0 font-mono text-[11px] text-(--color-ink-dim)">
          {objective.displayId}
        </span>
        {objective.assignedAgent ? (
          <AgentIcon agentKey={objective.assignedAgent} size={12} />
        ) : null}
      </button>
    </li>
  );
}

/**
 * A mission on the feed: live work, or a recent delivery. The card is the
 * mission and the rows beneath it are its whole plan. The whole header is the
 * button that opens the mission panel (mission only); each objective row in the
 * footer is a sibling button that opens that objective's detail.
 */
export function MissionRunCard({
  item,
  nowIso,
  onOpenMission
}: {
  item: ActivityFeedMissionItemDto;
  nowIso: string;
  onOpenMission: (args: { missionId: string; objectiveDisplayId?: string | null }) => void;
}) {
  const delivered = item.runState === 'delivered';
  const launching = item.runState === 'launching';
  const elapsed = delivered ? '' : elapsedLabel(item.startedAt, nowIso);
  const deliveredAgo = delivered ? relativeTime(item.occurredAt, nowIso) : '';

  return (
    <article className="relative shrink-0 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-1) transition-shadow hover:shadow-lg">
      <ActivityFeedOriginCorner
        createdByKind={item.createdByKind}
        createdByAgent={item.createdByAgent}
      />
      <button
        type="button"
        // The card body opens the mission only; each objective row opens its own detail.
        onClick={() => onOpenMission({ missionId: item.missionId })}
        className="flex w-full flex-col gap-2 p-3 pr-8 text-left"
      >
        <ActivityFeedCardMeta
          item={item}
          identity="mission"
          trailing={
            elapsed ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                {elapsed}
              </span>
            ) : deliveredAgo ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                {deliveredAgo}
              </span>
            ) : null
          }
        />

        <div className="flex min-w-0 items-center gap-2">
          <KindBadge
            tone={delivered ? 'delivered' : launching ? 'launching' : 'running'}
            icon={
              delivered ? (
                <CheckCircle2 className="size-3" aria-hidden="true" />
              ) : launching ? (
                <Rocket className="size-3" aria-hidden="true" />
              ) : (
                <StatusSpinner className="size-3" />
              )
            }
            label={delivered ? 'delivered' : launching ? 'launching' : 'executing'}
          />
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-(--color-ink)">
            {item.missionTitle}
          </h3>
        </div>

        <p className="line-clamp-2 wrap-anywhere text-base text-(--color-ink-dim)">
          {/* The latest event may be raw harness markup (a background task finishing); show it the
              way the mission feed does rather than as tag soup. */}
          {/* Falls back to the objective's human-facing summary, then its instructions (coo:1275). */}
          {(item.latestEventSummary && formatAgentHarnessText(item.latestEventSummary)) ||
            item.summaryPreview ||
            item.instructionPreview}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-ink-dim)">
          <ActivityFeedAgentLine
            agentKey={item.agentIdentifier}
            modelIdentifier={item.modelIdentifier}
          />
          {item.resourceKey ? (
            <span className="inline-flex items-center gap-1">
              <FolderOpen className="size-3" aria-hidden="true" />
              {item.resourceKey}
            </span>
          ) : null}
          {item.branch ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <GitBranch className="size-3" aria-hidden="true" />
              <span className="truncate font-mono">{item.branch}</span>
            </span>
          ) : null}
        </div>
      </button>

      {item.objectives.length > 0 ? (
        <footer className="border-t border-(--color-border) bg-(--color-surface-2) px-2 py-1.5">
          <ol className="grid gap-0.5">
            {item.objectives.map(objective => (
              <MissionObjectiveRow
                key={objective.objectiveId}
                objective={objective}
                onOpen={() =>
                  onOpenMission({
                    missionId: item.missionId,
                    objectiveDisplayId: objective.displayId || objective.objectiveId
                  })
                }
              />
            ))}
          </ol>
        </footer>
      ) : null}
    </article>
  );
}
