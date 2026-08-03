import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import type { MissionDetailDto } from '../../shared/contract.ts';
import { InboxMissionCard } from '@/components/InboxMissionCard.tsx';
import { useInboxItems } from '@/lib/queries.ts';

export function InboxPage() {
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

  if (inbox.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading Inbox…</div>;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 overflow-auto p-6">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Unassigned tasks stay private until you assign a project. After you assign one, keep
          working here — the card stays until you leave Inbox.
        </p>
      </div>

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

      {inboxItems.length === 0 && promotedCards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your Inbox is empty. Create a task without a project to capture it here.
        </p>
      ) : null}

      <Link to="/user" className="text-sm text-primary hover:underline">
        Back to My Missions
      </Link>
    </main>
  );
}
