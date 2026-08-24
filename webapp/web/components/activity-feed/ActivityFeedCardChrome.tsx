import type { MouseEvent, ReactNode } from 'react';

import type { ActivityFeedItemDto, CreatedByKind } from '../../../shared/contract.ts';
import { normalizeAgentKey } from '../../lib/helpers/agent-icons.ts';
import { cn } from '../../lib/utils.ts';
import { ObjectiveOriginMark } from '../../pages/MissionCardPrimitives.tsx';
import { AgentIcon } from '../objectives/AgentIcon.tsx';

/** Small colored dot standing in for the project, matching the board's accent color. */
export function ProjectDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ background: color ?? 'var(--color-ink-dim)' }}
    />
  );
}

/** The `launching` / `executing` / `delivered` / `blocking question` pill each card leads with. */
export function KindBadge({
  tone,
  icon,
  label
}: {
  tone: 'running' | 'question' | 'launching' | 'delivered';
  icon: ReactNode;
  label: string;
}) {
  const toneClass = {
    running:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-100',
    launching:
      'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-100',
    question:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100',
    delivered: 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink-dim)'
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        toneClass
      )}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * The context line every feed card shares: project, then the objective display
 * id as the live identity, then the parent mission as secondary context
 * (coo:756 §9.1 — activity surfaces are objective-first).
 */
const missionLinkClass =
  'min-w-0 truncate rounded-sm text-left transition-colors hover:text-(--color-ink) hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--color-border)';

export function ActivityFeedCardMeta({
  item,
  identity = 'objective',
  trailing,
  onMissionOpen
}: {
  item: ActivityFeedItemDto;
  /**
   * What the card itself is. A `mission` card carries the mission title as its
   * own heading, so its context line is just project and mission id — repeating
   * the title here would say the same thing twice.
   */
  identity?: 'objective' | 'mission';
  trailing?: ReactNode;
  /** When set, mission display id and title open the mission panel. */
  onMissionOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const openMission = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onMissionOpen?.(event);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--color-ink-dim)">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ProjectDot color={item.projectColor} />
        <span className="truncate">{item.projectName}</span>
      </span>
      {identity === 'mission' ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-xs font-medium text-(--color-ink)">
            {item.missionDisplayId}
          </span>
        </>
      ) : (
        <>
          {item.objectiveDisplayId ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs font-medium text-(--color-ink)">
                {item.objectiveDisplayId}
              </span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          {onMissionOpen ? (
            <>
              <button
                type="button"
                onClick={openMission}
                className={cn(missionLinkClass, 'font-mono font-medium text-(--color-ink)')}
              >
                {item.missionDisplayId}
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={openMission} className={missionLinkClass}>
                {item.missionTitle}
              </button>
            </>
          ) : (
            <span className="min-w-0 truncate">{item.missionTitle}</span>
          )}
        </>
      )}
      {trailing}
    </div>
  );
}

/**
 * Connector icon + model id. The protocol sentinel `unknown` is already null
 * after `normalizeAgentKey`; we never print a display name here — the icon is
 * the agent identifier, and the model string is the secondary label.
 */
export function ActivityFeedAgentLine({
  agentKey,
  modelIdentifier
}: {
  agentKey: string | null | undefined;
  modelIdentifier?: string | null;
}) {
  const normalized = normalizeAgentKey(agentKey);
  const model = modelIdentifier?.trim() || null;
  if (!normalized && !model) return null;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {normalized ? <AgentIcon agentKey={normalized} size={12} /> : null}
      {model ? <span className="truncate font-mono">{model}</span> : null}
    </span>
  );
}

/** Top-right sparkle when the underlying objective was agent-authored. */
export function ActivityFeedOriginCorner({
  createdByKind,
  createdByAgent
}: {
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
}) {
  return (
    <div className="pointer-events-auto absolute top-2.5 right-2.5 z-10">
      <ObjectiveOriginMark createdByKind={createdByKind} createdByAgent={createdByAgent} />
    </div>
  );
}
