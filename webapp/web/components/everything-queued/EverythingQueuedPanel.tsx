import { Link } from '@tanstack/react-router';
import { ListOrdered, Loader2 } from 'lucide-react';

import { useEverythingQueued } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import {
  describeQueueEntry,
  QUEUE_STATUS_DETAIL_CLASS,
  QUEUE_STATUS_PILL_CLASS
} from '../run-queue/queue-entry-status.ts';

/**
 * Read-only cross-project queue projection for Inbox. Queue state and ordering
 * remain owned by the project-scoped Run Queue surfaces.
 */
export function EverythingQueuedPanel() {
  const rollup = useEverythingQueued();

  return (
    <section className="flex min-h-0 shrink-0 basis-[380px] flex-col border-l border-(--color-border)">
      <div className="flex-none px-6 pb-3 pt-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
          Cross-project view
        </p>
        <h2 className="text-xl font-semibold tracking-tight">Everything Queued</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-ink-dim) text-pretty">
          Read-only queue entries from projects you can access. Each queue keeps its own order.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-6 pt-1">
        {rollup.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-(--color-ink-dim)">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading queued objectives…
          </p>
        ) : null}

        {rollup.isError ? (
          <p className="text-sm text-destructive">
            Could not load queued objectives. Check access and retry.
          </p>
        ) : null}

        {rollup.hasPartialError ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Some project queues could not be loaded. Entries you can access are shown.
          </p>
        ) : null}

        {!rollup.isLoading && !rollup.isError && rollup.data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-(--color-ink-dim)">
            No queued objectives across projects you can access.
          </div>
        ) : null}

        {rollup.data.map(({ projectId, projectName, workspaceName, queue }) => (
          <article key={queue.id} className="rounded-lg border border-border bg-muted/15 p-3">
            <div className="mb-2 flex items-start gap-2">
              <ListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{queue.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {workspaceName} · {projectName}
                  {queue.paused ? ' · Paused' : ''}
                </p>
              </div>
            </div>
            <ol className="space-y-1.5">
              {queue.entries.map(entry => {
                const status = describeQueueEntry(entry);
                return (
                  <li
                    key={entry.id}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-2"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {entry.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/projects/$projectId/missions/$missionId"
                        params={{ projectId, missionId: entry.missionId }}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {entry.objectiveTitle ?? entry.objectiveDisplayId}
                      </Link>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {entry.missionTitle} · {entry.objectiveDisplayId}
                      </p>
                      {status.detail ? (
                        <p
                          className={cn(
                            'mt-0.5 truncate text-[11px]',
                            QUEUE_STATUS_DETAIL_CLASS[status.tone]
                          )}
                        >
                          {status.detail}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        QUEUE_STATUS_PILL_CLASS[status.tone]
                      )}
                    >
                      {status.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
