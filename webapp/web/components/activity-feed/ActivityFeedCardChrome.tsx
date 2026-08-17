import type { ReactNode } from 'react';

import type { ActivityFeedItemDto } from '../../../shared/contract.ts';
import { cn } from '../../lib/utils.ts';

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

/** The `executing` / `delivered` / `blocking question` pill each card leads with. */
export function KindBadge({
  tone,
  icon,
  label
}: {
  tone: 'running' | 'delivered' | 'question' | 'launching';
  icon: ReactNode;
  label: string;
}) {
  const toneClass = {
    running:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-100',
    launching:
      'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-100',
    delivered:
      'border-(--color-border) bg-(--color-surface-2) text-(--color-ink) dark:border-(--color-border)',
    question:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100'
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        toneClass
      )}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * The context line every feed card shares: project, mission, objective display id.
 * Written once so the three card kinds cannot drift in how they identify their work.
 */
export function ActivityFeedCardMeta({
  item,
  trailing
}: {
  item: ActivityFeedItemDto;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-(--color-ink-dim)">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ProjectDot color={item.projectColor} />
        <span className="truncate">{item.projectName}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate font-medium text-(--color-ink)">{item.missionTitle}</span>
      {item.objectiveDisplayId ? (
        <span className="font-mono text-[10px] text-(--color-ink-dim)">
          {item.objectiveDisplayId}
        </span>
      ) : null}
      {trailing}
    </div>
  );
}
