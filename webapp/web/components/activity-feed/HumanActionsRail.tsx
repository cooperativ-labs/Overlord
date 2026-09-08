import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
  RotateCcw,
  X
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { HumanActionItemDto } from '../../../shared/contract.ts';
import {
  useClearAllHumanActions,
  useHumanActions,
  useReopenHumanAction,
  useResolveHumanAction
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { HumanActionDetails } from '../HumanActionDetails.tsx';
import { Spinner } from '../ui.tsx';

import { relativeTime } from './activity-feed-model.ts';
import { ProjectDot } from './ActivityFeedCardChrome.tsx';
import {
  groupHumanActions,
  humanActionCategoryLabel,
  type HumanActionMissionGroup,
  type HumanActionObjectiveGroup
} from './human-actions-model.ts';

type OpenMission = (args: { missionId: string; objectiveDisplayId?: string | null }) => void;

const iconButtonClass =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-(--color-ink-dim) transition-colors hover:border-(--color-border) hover:bg-(--color-surface-2) hover:text-(--color-ink) disabled:opacity-50';

/**
 * One reported action: a check box to mark it done, a dismiss control for
 * actions that turn out not to apply, and reopen for either. The text is the
 * agent's own; the rail never rewrites it.
 */
function HumanActionRow({ item, nowIso }: { item: HumanActionItemDto; nowIso: string }) {
  const resolve = useResolveHumanAction();
  const reopen = useReopenHumanAction();
  const busy = resolve.isPending || reopen.isPending;
  const resolved = item.resolution !== null;

  return (
    <li
      className={cn(
        'group flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5',
        resolved ? 'opacity-60' : 'hover:bg-(--color-surface-2)'
      )}
    >
      {resolved ? (
        <button
          type="button"
          className={cn(iconButtonClass, 'mt-0.5')}
          disabled={busy}
          title="Reopen"
          aria-label={`Reopen: ${item.action}`}
          onClick={() => reopen.mutate({ deliveryId: item.deliveryId, actionId: item.actionId })}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-label={`Mark done: ${item.action}`}
          title="Mark done"
          disabled={busy}
          onClick={() =>
            resolve.mutate({
              deliveryId: item.deliveryId,
              actionId: item.actionId,
              status: 'done'
            })
          }
          className="mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded border border-(--color-border) bg-(--color-surface) text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500 disabled:opacity-50"
        >
          <Check className="size-3" aria-hidden="true" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'wrap-anywhere text-sm leading-snug text-(--color-ink)',
            resolved && 'line-through'
          )}
        >
          {item.blocking && !resolved ? (
            <AlertTriangle
              className="mr-1 inline size-3.5 -translate-y-px text-amber-500"
              aria-label="Blocking"
            />
          ) : null}
          {item.action}
        </p>
        {item.reason ? (
          <p className="mt-0.5 wrap-anywhere text-xs leading-snug text-(--color-ink-dim)">
            {item.reason}
          </p>
        ) : null}
        {!resolved ? <HumanActionDetails action={item} /> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wide text-(--color-ink-dim)">
          <span className="rounded bg-(--color-surface-3) px-1 py-px font-mono normal-case tracking-normal">
            {humanActionCategoryLabel(item.category)}
          </span>
          {item.source !== 'agent' ? <span>inferred</span> : null}
          {resolved ? (
            <span>
              {item.resolution?.status === 'dismissed' ? 'Dismissed' : 'Done'}{' '}
              {relativeTime(item.resolution?.resolvedAt ?? null, nowIso)}
            </span>
          ) : null}
        </p>
      </div>

      {!resolved ? (
        <button
          type="button"
          className={cn(
            iconButtonClass,
            'mt-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          )}
          disabled={busy}
          title="Dismiss (does not apply)"
          aria-label={`Dismiss: ${item.action}`}
          onClick={() =>
            resolve.mutate({
              deliveryId: item.deliveryId,
              actionId: item.actionId,
              status: 'dismissed'
            })
          }
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function ObjectiveGroup({
  group,
  missionId,
  nowIso,
  onOpenMission
}: {
  group: HumanActionObjectiveGroup;
  missionId: string;
  nowIso: string;
  onOpenMission: OpenMission;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => onOpenMission({ missionId, objectiveDisplayId: group.objectiveDisplayId })}
        className="flex w-full min-w-0 items-baseline gap-2 rounded-sm px-2 text-left text-[11px] text-(--color-ink-dim) hover:text-(--color-ink) hover:underline"
        title={group.objectiveTitle ?? group.objectiveDisplayId}
      >
        <span className="font-mono">{group.objectiveDisplayId}</span>
        {group.objectiveTitle ? (
          <span className="min-w-0 truncate">{group.objectiveTitle}</span>
        ) : null}
        <span className="ml-auto shrink-0">{relativeTime(group.deliveredAt, nowIso)}</span>
      </button>
      <ul className="mt-0.5 flex flex-col">
        {group.items.map(item => (
          <HumanActionRow key={item.id} item={item} nowIso={nowIso} />
        ))}
      </ul>
    </div>
  );
}

function MissionGroup({
  group,
  nowIso,
  onOpenMission
}: {
  group: HumanActionMissionGroup;
  nowIso: string;
  onOpenMission: OpenMission;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border bg-(--color-surface) p-2',
        group.blocking ? 'border-amber-300 dark:border-amber-500/50' : 'border-(--color-border)'
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand mission' : 'Collapse mission'}
          onClick={() => setCollapsed(value => !value)}
          className={iconButtonClass}
        >
          <Chevron className="size-3.5" aria-hidden="true" />
        </button>
        <ProjectDot color={group.projectColor} />
        <button
          type="button"
          onClick={() => onOpenMission({ missionId: group.missionId })}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-(--color-ink) hover:underline"
          title={`${group.missionDisplayId} · ${group.missionTitle}`}
        >
          {group.missionTitle}
        </button>
        {group.openCount > 0 ? (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 font-mono text-[10px]',
              group.blocking
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100'
                : 'bg-(--color-surface-3) text-(--color-ink-dim)'
            )}
          >
            {group.openCount}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 truncate pl-8 text-[11px] text-(--color-ink-dim)">
        <span className="font-mono">{group.missionDisplayId}</span> · {group.projectName}
      </p>
      {!collapsed ? (
        <div className="mt-2 flex flex-col gap-2">
          {group.objectives.map(objective => (
            <ObjectiveGroup
              key={objective.objectiveId}
              group={objective}
              missionId={group.missionId}
              nowIso={nowIso}
              onOpenMission={onOpenMission}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The Feed page's left rail: every human follow-up action agents reported on
 * recent deliveries, grouped by mission and objective, with the operator's
 * done / dismissed decisions recorded against each one (coo:963). Blocking
 * actions and the missions carrying them lead. Resolved actions stay out of
 * the way until asked for.
 */
export function HumanActionsRail({
  nowIso,
  onOpenMission
}: {
  nowIso: string;
  onOpenMission: OpenMission;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const { data, error, isError, isLoading } = useHumanActions(showResolved);
  const clearAll = useClearAllHumanActions();
  const groups = useMemo(() => groupHumanActions(data?.items ?? []), [data?.items]);
  const counts = data?.counts;
  const openItems = useMemo(
    () => (data?.items ?? []).filter(item => item.resolution === null),
    [data?.items]
  );

  return (
    <aside
      aria-label="Human actions"
      className="flex w-[340px] min-w-[300px] max-w-[40vw] flex-none flex-col border-r border-(--color-border) bg-(--color-surface)"
    >
      <div className="flex-none border-b border-(--color-border) px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
            Waiting on you
          </p>
          {openItems.length > 0 ? (
            <button
              type="button"
              disabled={clearAll.isPending}
              title="Dismiss all open human actions"
              aria-label="Clear all human actions"
              onClick={() =>
                clearAll.mutate({
                  items: openItems.map(item => ({
                    deliveryId: item.deliveryId,
                    actionId: item.actionId
                  }))
                })
              }
              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-(--color-ink-dim) transition-colors hover:bg-(--color-surface-2) hover:text-(--color-ink) disabled:opacity-50"
            >
              {clearAll.isPending ? 'Clearing…' : 'Clear all'}
            </button>
          ) : null}
        </div>
        <h2 className="mt-0.5 flex items-center gap-2 text-base font-semibold tracking-tight">
          <ListChecks className="size-4 text-(--color-ink-dim)" aria-hidden="true" />
          Human actions
          {counts ? (
            <span className="rounded-full bg-(--color-surface-3) px-1.5 font-mono text-[11px] font-normal text-(--color-ink-dim)">
              {counts.open}
            </span>
          ) : null}
          {counts && counts.blocking > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 font-mono text-[11px] font-normal text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
              <AlertTriangle className="size-3" aria-hidden="true" />
              {counts.blocking} blocking
            </span>
          ) : null}
        </h2>
        <p className="mt-1 text-xs text-(--color-ink-dim)">
          Follow-up steps agents reported when delivering, from the last 90 days.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-(--color-surface-2) p-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : isError ? (
          <p className="text-sm text-red-400">
            Could not load human actions: {(error as Error)?.message ?? 'unknown error'}
          </p>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--color-border) p-5 text-center">
            <p className="text-sm font-medium text-(--color-ink)">Nothing waiting on you</p>
            <p className="mt-1 text-xs text-(--color-ink-dim)">
              When an agent delivers with steps only a person can take, they show up here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map(group => (
              <MissionGroup
                key={group.missionId}
                group={group}
                nowIso={nowIso}
                onOpenMission={onOpenMission}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-(--color-border) px-4 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-(--color-ink-dim)">
          <input
            type="checkbox"
            className="size-3.5"
            checked={showResolved}
            onChange={event => setShowResolved(event.target.checked)}
          />
          Show resolved
          {counts && counts.resolved > 0 ? (
            <span className="font-mono text-[10px]">({counts.resolved})</span>
          ) : null}
        </label>
      </div>
    </aside>
  );
}
