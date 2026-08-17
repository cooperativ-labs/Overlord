import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { ActivityFeed } from '@/components/activity-feed/ActivityFeed.tsx';
import { InboxMissionCard } from '@/components/InboxMissionCard.tsx';
import { MissionDrawer } from '@/components/MissionDrawer.tsx';
import { MissionPanel } from '@/components/MissionPanel.tsx';
import { ProjectWorkspaceErrorBoundary } from '@/components/ProjectWorkspaceErrorBoundary.tsx';
import { useInboxItems } from '@/lib/queries.ts';

import type { MissionDetailDto } from '../../shared/contract.ts';

/** Left column: unallocated captures, unchanged apart from living beside the feed. */
function UnallocatedColumn() {
  const inbox = useInboxItems();
  // Promoted cards stay mounted for this Inbox visit so assigning a project
  // unlocks agent/run controls in place instead of yanking the row away.
  const [promotedByInboxId, setPromotedByInboxId] = useState<Map<string, MissionDetailDto>>(
    () => new Map()
  );

  const inboxItems = useMemo(() => {
    const promotedIds = new Set(promotedByInboxId.keys());
    return (inbox.data ?? []).filter(item => !promotedIds.has(item.id));
  }, [inbox.data, promotedByInboxId]);

  const promotedCards = useMemo(() => [...promotedByInboxId.entries()], [promotedByInboxId]);

  return (
    <section className="flex min-h-0 shrink-0 basis-[440px] flex-col border-r border-(--color-border)">
      <div className="flex-none px-6 pb-3 pt-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
          Unallocated · {inboxItems.length + promotedCards.length}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-ink-dim) text-pretty">
          Unassigned tasks stay private until you assign a project. After you assign one, keep
          working here — the card stays until you leave Inbox.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-1">
        {inbox.isLoading ? <p className="text-sm text-(--color-ink-dim)">Loading Inbox…</p> : null}

        {inboxItems.map(item => (
          <InboxMissionCard
            key={item.id}
            variant="inbox"
            item={item}
            onPromoted={mission => {
              setPromotedByInboxId(current => {
                const next = new Map(current);
                next.set(item.id, mission);
                return next;
              });
            }}
          />
        ))}

        {promotedCards.map(([inboxId, mission]) => (
          <InboxMissionCard key={inboxId} variant="mission" mission={mission} />
        ))}

        {!inbox.isLoading && inboxItems.length === 0 && promotedCards.length === 0 ? (
          <p className="text-sm text-(--color-ink-dim)">
            Your Inbox is empty. Create a task without a project to capture it here.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The Inbox surface: unallocated capture on the left, a cross-workspace feed of
 * objective activity on the right, and the mission panel in a nested drawer so a
 * running objective can be opened without leaving for its project board (coo:757).
 */
export function InboxPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
        <UnallocatedColumn />
        <ProjectWorkspaceErrorBoundary region="activity feed">
          <ActivityFeed
            onOpenMission={missionId =>
              void navigate({ to: '/inbox/missions/$missionId', params: { missionId } })
            }
          />
        </ProjectWorkspaceErrorBoundary>
      </main>
      <ProjectWorkspaceErrorBoundary region="mission panel">
        <Outlet />
      </ProjectWorkspaceErrorBoundary>
    </div>
  );
}

/** The mission panel opened from an activity-feed card; closes back to `/inbox`. */
export function InboxMissionPanelRoute() {
  const { missionId } = useParams({ from: '/inbox/missions/$missionId' });
  const navigate = useNavigate();
  return (
    <MissionDrawer>
      <MissionPanel
        projectId=""
        missionId={missionId}
        onClose={() => void navigate({ to: '/inbox' })}
        onProjectChanged={() =>
          void navigate({ to: '/inbox/missions/$missionId', params: { missionId } })
        }
      />
    </MissionDrawer>
  );
}
