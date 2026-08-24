import { useMemo, useState } from 'react';

import { EverythingQueuedPanel } from '@/components/everything-queued/EverythingQueuedPanel.tsx';
import { InboxMissionCard } from '@/components/InboxMissionCard.tsx';
import { ProjectWorkspaceErrorBoundary } from '@/components/ProjectWorkspaceErrorBoundary.tsx';
import { useInboxItems, useInboxMissions } from '@/lib/queries.ts';

import type { InboxMissionDto, MissionDetailDto } from '../../shared/contract.ts';

import { MissionCard } from './MissionCard.tsx';

/** Left column: unallocated captures plus agent-Next mission triage. */
function InboxColumn() {
  const inbox = useInboxItems();
  const inboxMissions = useInboxMissions();
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

  const missions = useMemo(() => inboxMissions.data?.missions ?? [], [inboxMissions.data]);

  const captureCount = inboxItems.length + promotedCards.length;
  const isEmpty =
    !inbox.isLoading && !inboxMissions.isLoading && captureCount === 0 && missions.length === 0;

  return (
    <section className="flex min-h-0 min-w-[440px] flex-1 flex-col">
      <div className="flex-none px-6 pb-3 pt-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
          Inbox · {captureCount + missions.length}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-ink-dim) text-pretty">
          Unassigned captures stay private until you assign a project. Agent-filed Next work
          lands here for triage.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-1">
        {inbox.isLoading ? (
          <p className="text-sm text-(--color-ink-dim)">Loading captures…</p>
        ) : null}

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

        {missions.length > 0 ? (
          <div className="mt-2 flex flex-col gap-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-(--color-ink-dim)">
              Missions · {missions.length}
            </p>
            {inboxMissions.isLoading ? (
              <p className="text-sm text-(--color-ink-dim)">Loading missions…</p>
            ) : null}
            {missions.map(mission => (
              <InboxTriageMissionCard key={mission.id} mission={mission} />
            ))}
          </div>
        ) : inboxMissions.isLoading ? (
          <p className="text-sm text-(--color-ink-dim)">Loading missions…</p>
        ) : null}

        {isEmpty ? (
          <p className="text-sm text-(--color-ink-dim)">
            Your Inbox is empty. Create a task without a project to capture it here, or wait for
            agent-filed Next missions to appear.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function InboxTriageMissionCard({ mission }: { mission: InboxMissionDto }) {
  const reasonLabel = mission.reasons.includes('agent_next')
    ? mission.reasons.includes('recent')
      ? 'Recent · Agent Next'
      : 'Agent Next'
    : 'Recent';

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-(--color-ink-dim)">
        {reasonLabel}
        {mission.createdByKind === 'agent' && mission.createdByAgent
          ? ` · ${mission.createdByAgent}`
          : ''}
      </p>
      <MissionCard
        mission={mission}
        projectId={mission.projectId}
        projectName={mission.projectName}
        projectColor={mission.projectColor}
      />
    </div>
  );
}

/**
 * The Inbox surface: unallocated capture and recent/agent-Next mission triage on
 * the left, cross-project queue on the right. Live objective activity lives on
 * `/feed`.
 */
export function InboxPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <InboxColumn />
        <ProjectWorkspaceErrorBoundary region="Everything Queued">
          <EverythingQueuedPanel />
        </ProjectWorkspaceErrorBoundary>
      </main>
    </div>
  );
}
