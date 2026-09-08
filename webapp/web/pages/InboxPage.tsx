import { InboxTaskList } from '@/components/inbox-tasks/InboxTaskList.tsx';
import { useInboxItems, useInboxMissions } from '@/lib/queries.ts';

/**
 * The Inbox surface: a task list. Private captures (`inbox_items`) and
 * cross-workspace triage missions share one list bucketed by due state.
 * Captures gain a project, and thereby become missions, from the row or its
 * expanded editor. The Run Queue lives in the nav-header queue sheet; live
 * objective activity lives on `/feed`.
 */
export function InboxPage() {
  const inbox = useInboxItems();
  const inboxMissions = useInboxMissions();
  const total = (inbox.data?.length ?? 0) + (inboxMissions.data?.missions.length ?? 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <section className="flex min-h-0 min-w-[440px] flex-1 flex-col">
          <div className="flex-none px-6 pb-3 pt-5">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
              Inbox · {total}
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-ink-dim) text-pretty">
              Your task list. Captures stay private until you assign a project, which turns them
              into missions. Agent-filed Next work and anything overdue or due today or tomorrow
              land here too.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-1">
            <div className="mx-auto w-full max-w-4xl">
              <InboxTaskList />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
