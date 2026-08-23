import { CircleHelp, Filter, Loader2, Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useActivityFeed } from '../../lib/queries.ts';
import { useRealtime } from '../../lib/realtime.tsx';
import { cn } from '../../lib/utils.ts';
import { Spinner } from '../ui.tsx';

import {
  FEED_KIND_LABELS,
  FEED_KINDS,
  feedProjectOptions,
  filterFeedItems,
  isDeliveryItem,
  isQuestionItem,
  isRunItem,
  truncationNote
} from './activity-feed-model.ts';
import { ProjectDot } from './ActivityFeedCardChrome.tsx';
import { BlockingQuestionCard } from './BlockingQuestionCard.tsx';
import { DeliveryFeedCard } from './DeliveryFeedCard.tsx';
import { ObjectiveRunCard } from './ObjectiveRunCard.tsx';

const KIND_ICONS = {
  objective_run: Loader2,
  blocking_question: CircleHelp,
  delivery: Package
} as const;

/** Elapsed labels re-render on this cadence; the data itself arrives over realtime. */
const TICK_MS = 30_000;

function LiveIndicator() {
  const { state } = useRealtime();
  const live = state === 'live';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-(--color-ink-dim)">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          live ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'
        )}
      />
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

/**
 * The Feed page's activity column: one time-descending merge of executing
 * objectives, blocking questions, and recent deliveries across every workspace
 * the operator can read. Freshness rides the existing realtime change link —
 * this component never polls.
 */
export function ActivityFeed({
  onOpenMission
}: {
  onOpenMission: (args: { missionId: string; objectiveDisplayId?: string | null }) => void;
}) {
  const feed = useActivityFeed();
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(() => new Set(FEED_KINDS));
  const [projectId, setProjectId] = useState<string | null>(null);
  // Elapsed/relative labels advance between refetches by walking a local clock
  // forward, rather than by refetching the feed on a timer.
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const projects = useMemo(() => feedProjectOptions(items), [items]);

  // The server's `generatedAt` is the floor, so a browser clock running behind the
  // backend never renders negative elapsed time on a freshly fetched item.
  const nowIso = useMemo(() => {
    const generated = feed.data?.generatedAt ? new Date(feed.data.generatedAt).getTime() : 0;
    return new Date(Math.max(generated, clock)).toISOString();
  }, [feed.data?.generatedAt, clock]);

  const visible = useMemo(
    () => filterFeedItems(items, { kinds: enabledKinds, projectId }),
    [items, enabledKinds, projectId]
  );

  const countsByKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return counts;
  }, [items]);

  const truncated = feed.data ? truncationNote(feed.data.counts, items) : null;

  const toggleKind = (kind: string) => {
    setEnabledKinds(current => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex-none border-b border-(--color-border) px-6 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
              Objective activity
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Feed</h1>
          </div>
          <LiveIndicator />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setProjectId(null)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors',
              projectId === null
                ? 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink)'
                : 'border-transparent text-(--color-ink-dim) hover:bg-(--color-surface-2)'
            )}
          >
            <Filter className="size-3" aria-hidden="true" />
            All projects
          </button>
          {projects.map(project => (
            <button
              key={project.projectId}
              type="button"
              onClick={() =>
                setProjectId(current => (current === project.projectId ? null : project.projectId))
              }
              className={cn(
                'inline-flex h-7 max-w-[12rem] items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors',
                projectId === project.projectId
                  ? 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink)'
                  : 'border-transparent text-(--color-ink-dim) hover:bg-(--color-surface-2)'
              )}
            >
              <ProjectDot color={project.projectColor} />
              <span className="truncate">{project.projectName}</span>
            </button>
          ))}

          <span className="mx-1 h-4 w-px bg-(--color-border)" aria-hidden="true" />

          {FEED_KINDS.map(kind => {
            const Icon = KIND_ICONS[kind];
            const on = enabledKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(kind)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors',
                  on
                    ? 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink)'
                    : 'border-transparent text-(--color-ink-dim) opacity-60 hover:opacity-100'
                )}
              >
                <Icon className="size-3" aria-hidden="true" />
                {FEED_KIND_LABELS[kind]}
                <span className="rounded bg-(--color-surface-3) px-1 font-mono text-[10px]">
                  {countsByKind.get(kind) ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scroll the pane; keep the stack unconstrained so overflow-hidden cards do not shrink. */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-(--color-surface-2) p-4">
        <div className="flex flex-col gap-3">
          {feed.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : feed.isError ? (
            <p className="text-sm text-red-400">
              Could not load activity: {(feed.error as Error)?.message ?? 'unknown error'}
            </p>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-(--color-border) p-6 text-center">
              <p className="text-sm font-medium text-(--color-ink)">
                {items.length === 0
                  ? 'No recent objective activity'
                  : 'Nothing matches these filters'}
              </p>
              <p className="mt-1 text-xs text-(--color-ink-dim)">
                {items.length === 0
                  ? 'Launch an objective and it will appear here while it runs.'
                  : 'Turn a filter back on to see deliveries and executing objectives again.'}
              </p>
            </div>
          ) : (
            visible.map(item => {
              if (isRunItem(item)) {
                return (
                  <ObjectiveRunCard
                    key={item.id}
                    item={item}
                    nowIso={nowIso}
                    onOpenMission={onOpenMission}
                  />
                );
              }
              if (isQuestionItem(item)) {
                return (
                  <BlockingQuestionCard
                    key={item.id}
                    item={item}
                    nowIso={nowIso}
                    onOpenMission={onOpenMission}
                  />
                );
              }
              if (isDeliveryItem(item)) {
                return (
                  <DeliveryFeedCard
                    key={item.id}
                    item={item}
                    nowIso={nowIso}
                    onOpenMission={onOpenMission}
                  />
                );
              }
              return null;
            })
          )}

          {truncated ? (
            <p className="pb-2 text-center text-[11px] text-(--color-ink-dim)">{truncated}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
