import { Clock, FastForward, FolderOpen, GitBranch, Loader2, Rocket } from 'lucide-react';

import type { ActivityFeedRunItemDto } from '../../../shared/contract.ts';
import { AgentIcon } from '../objectives/AgentIcon.tsx';

import { elapsedLabel } from './activity-feed-model.ts';
import {
  ActivityFeedAgentLine,
  ActivityFeedCardMeta,
  ActivityFeedOriginCorner,
  KindBadge
} from './ActivityFeedCardChrome.tsx';

/**
 * A launching or executing objective. The whole card is the button that opens the
 * mission panel: an operator scanning the feed is looking for "what is this agent
 * doing", and that answer lives in the panel, not on a nested control.
 */
export function ObjectiveRunCard({
  item,
  nowIso,
  onOpenMission
}: {
  item: ActivityFeedRunItemDto;
  nowIso: string;
  onOpenMission: (args: { missionId: string; objectiveDisplayId?: string | null }) => void;
}) {
  const launching = item.state === 'launching';
  const elapsed = elapsedLabel(item.startedAt, nowIso);

  return (
    <article className="relative shrink-0 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-1)">
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
        className="flex w-full flex-col gap-2 p-3 pr-8 text-left transition-colors hover:bg-(--color-surface-2)"
      >
        <ActivityFeedCardMeta
          item={item}
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
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-ink)">
            {item.objectiveTitle ?? item.instructionPreview.slice(0, 80) ?? 'Objective'}
          </h3>
        </div>

        <p className="line-clamp-2 wrap-anywhere text-sm text-(--color-ink-dim)">
          {item.latestEventSummary ?? item.instructionPreview}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-(--color-ink-dim)">
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

      {item.upcoming.length > 0 ? (
        <footer className="border-t border-(--color-border) bg-(--color-surface-2) px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-(--color-ink-dim)">
            <FastForward className="size-3" aria-hidden="true" />
            Auto-advances to {item.upcoming.length} more
          </div>
          <ol className="mt-1.5 grid gap-1">
            {item.upcoming.map((next, index) => (
              <li
                key={next.objectiveId}
                className="flex min-w-0 items-center gap-2 text-[11px] text-(--color-ink-dim)"
              >
                <span className="w-4 shrink-0 text-right font-mono">{index + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-(--color-ink)">
                  {next.title ?? 'Untitled objective'}
                </span>
                <span className="shrink-0 font-mono text-[10px]">{next.displayId}</span>
                {next.assignedAgent ? <AgentIcon agentKey={next.assignedAgent} size={12} /> : null}
              </li>
            ))}
          </ol>
        </footer>
      ) : null}
    </article>
  );
}
