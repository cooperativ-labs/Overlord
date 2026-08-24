import {
  CheckCircle2,
  Circle,
  Clock,
  FastForward,
  FolderOpen,
  GitBranch,
  Loader2,
  RefreshCw,
  Rocket
} from 'lucide-react';

import type {
  ActivityFeedMissionItemDto,
  ActivityFeedMissionObjectiveDto
} from '../../../shared/contract.ts';
import { cn } from '../../lib/utils.ts';
import { AgentIcon } from '../objectives/AgentIcon.tsx';

import { elapsedLabel, isInFlightObjectiveState } from './activity-feed-model.ts';
import {
  ActivityFeedAgentLine,
  ActivityFeedCardMeta,
  ActivityFeedOriginCorner,
  KindBadge
} from './ActivityFeedCardChrome.tsx';

/**
 * The state mark for one objective row, matching the mission panel's own
 * vocabulary so the feed and the panel never disagree about what a mission is
 * doing. `pending_delivery` is a refresh mark, not a warning: the agent
 * re-attached after finishing a turn and nothing has gone wrong.
 */
function ObjectiveStateIcon({ state }: { state: ActivityFeedMissionObjectiveDto['state'] }) {
  if (state === 'executing') {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-(--color-ink-dim)" />;
  }
  if (state === 'pending_delivery') {
    return (
      <RefreshCw className="size-3.5 shrink-0 animate-spin text-(--color-ink-dim) [animation-duration:2.5s]" />
    );
  }
  if (state === 'complete') {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />;
  }
  if (state === 'launching') {
    return <Rocket className="size-3.5 shrink-0 text-sky-500" />;
  }
  return <Circle className="size-3.5 shrink-0 text-(--color-ink-dim)/50" />;
}

/**
 * One objective under a mission card. Live work carries the same emerald
 * shimmer sweep the mission panel uses, so which step is running is visible
 * without reading a single word.
 */
function MissionObjectiveRow({ objective }: { objective: ActivityFeedMissionObjectiveDto }) {
  const inFlight = isInFlightObjectiveState(objective.state);

  return (
    <li className="relative overflow-hidden rounded-md">
      {inFlight ? (
        <div className="pointer-events-none absolute inset-0 animate-[shimmer_3s_linear_infinite] bg-size-[200%_100%] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
      ) : null}
      <div className="relative flex min-w-0 items-center gap-2 px-2 py-1 text-xs">
        <ObjectiveStateIcon state={objective.state} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            objective.state === 'complete' ? 'text-(--color-ink-dim)' : 'text-(--color-ink)',
            inFlight && 'font-medium'
          )}
        >
          {objective.title ?? 'Untitled objective'}
        </span>
        {objective.autoAdvance ? (
          <FastForward
            className="size-3 shrink-0 text-(--color-ink-dim)"
            aria-label="Auto-advance"
          />
        ) : null}
        <span className="shrink-0 font-mono text-[11px] text-(--color-ink-dim)">
          {objective.displayId}
        </span>
        {objective.assignedAgent ? (
          <AgentIcon agentKey={objective.assignedAgent} size={12} />
        ) : null}
      </div>
    </li>
  );
}

/**
 * A mission with live work: launching, executing, or awaiting delivery. The card
 * is the mission and the rows beneath it are its whole plan, so an operator can
 * see both what is running and what it sits between. The whole header is the
 * button that opens the mission panel — the answer to "what is this agent doing"
 * lives there, not on a nested control.
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
  const launching = item.runState === 'launching';
  const elapsed = elapsedLabel(item.startedAt, nowIso);

  return (
    <article className="relative shrink-0 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-1) transition-shadow hover:shadow-lg">
      <ActivityFeedOriginCorner
        createdByKind={item.createdByKind}
        createdByAgent={item.createdByAgent}
      />
      <button
        type="button"
        onClick={() =>
          onOpenMission({
            missionId: item.missionId,
            objectiveDisplayId: item.objectiveDisplayId
          })
        }
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
            ) : null
          }
        />

        <div className="flex min-w-0 items-center gap-2">
          <KindBadge
            tone={launching ? 'launching' : 'running'}
            icon={
              launching ? (
                <Rocket className="size-3" aria-hidden="true" />
              ) : (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              )
            }
            label={launching ? 'launching' : 'executing'}
          />
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-(--color-ink)">
            {item.missionTitle}
          </h3>
        </div>

        <p className="line-clamp-2 wrap-anywhere text-base text-(--color-ink-dim)">
          {item.latestEventSummary ?? item.instructionPreview}
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
              <MissionObjectiveRow key={objective.objectiveId} objective={objective} />
            ))}
          </ol>
        </footer>
      ) : null}
    </article>
  );
}
