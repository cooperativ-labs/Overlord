import { useMemo, useState } from 'react';

import { InboxMissionCard } from '@/components/InboxMissionCard.tsx';
import { useInboxItems, useInboxMissions } from '@/lib/queries.ts';

import type { InboxMissionDto, MissionDetailDto } from '../../shared/contract.ts';

import { MissionCard } from './MissionCard.tsx';

/** Left column: unallocated captures plus agent-Next and due-soon mission triage. */
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
          Unassigned captures stay private until you assign a project. Agent-filed Next work and
          anything overdue or due today or tomorrow land here for triage.
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
            agent-filed Next missions and work that is overdue or due today or tomorrow to appear.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Inclusion reasons read left to right, most urgent first: a missed due date
 * outranks an imminent one, which outranks agent-filed Next work, and `recent`
 * is a modifier rather than a reason of its own.
 */
function inboxReasonLabel(mission: InboxMissionDto): string {
  const parts: string[] = [];
  if (mission.reasons.includes('overdue')) {
    // The server decided the row is overdue; the client only counts the days,
    // so fall back rather than drop the label if the clocks disagree.
    parts.push(overdueLabel(mission.dueDatetime) ?? 'Overdue');
  }
  if (mission.reasons.includes('due_soon')) {
    // The server decided the row is due-soon; the client only names the day, so
    // fall back rather than drop the label if the clocks straddle UTC midnight.
    parts.push(dueSoonLabel(mission.dueDatetime) ?? 'Due soon');
  }
  if (mission.reasons.includes('agent_next')) parts.push('Agent Next');
  if (mission.reasons.includes('recent')) parts.push('Recent');
  return parts.length > 0 ? parts.join(' · ') : 'Inbox';
}

/** Whole UTC days between a due date and today, negative once the date has passed. */
function dueDayOffset(dueDatetime: string | null): number | null {
  if (!dueDatetime) return null;
  const due = new Date(dueDatetime);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueDay - startOfToday) / dayMs);
}

/** `Overdue 1 day` / `Overdue 6 days` against the UTC day boundaries the API uses. */
function overdueLabel(dueDatetime: string | null): string | null {
  const offset = dueDayOffset(dueDatetime);
  if (offset === null || offset >= 0) return null;
  const days = -offset;
  return days === 1 ? 'Overdue 1 day' : `Overdue ${days} days`;
}

/** `Due today` / `Due tomorrow` against the same UTC day boundaries the API uses. */
function dueSoonLabel(dueDatetime: string | null): string | null {
  const offset = dueDayOffset(dueDatetime);
  if (offset === 0) return 'Due today';
  if (offset === 1) return 'Due tomorrow';
  return null;
}

function InboxTriageMissionCard({ mission }: { mission: InboxMissionDto }) {
  const reasonLabel = inboxReasonLabel(mission);

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
 * The Inbox surface: unallocated capture plus agent-Next and due-today/tomorrow
 * mission triage. The Run Queue lives in the nav-header queue sheet. Live objective
 * activity lives on `/feed`.
 */
export function InboxPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <InboxColumn />
      </main>
    </div>
  );
}
