import { Link } from '@tanstack/react-router';

import type { MissionDetailDto } from '../../../shared/contract.ts';

import { InboxCardShell } from './InboxCardShell.tsx';
import { usePromotedInboxCard } from './use-promoted-inbox-card.ts';

export function PromotedInboxMissionCard({ initialMission }: { initialMission: MissionDetailDto }) {
  const { mission, shellProps } = usePromotedInboxCard(initialMission);

  return (
    <InboxCardShell
      {...shellProps}
      projectLocked
      showDelete={false}
      assignedBanner={
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Assigned to{' '}
            <span className="font-medium text-foreground">
              {shellProps.selectedProject?.name ?? 'project'}
            </span>
            . Stays here until you leave Inbox.
          </span>
          <Link
            to="/user/missions/$missionId"
            params={{ missionId: mission.id }}
            className="font-mono text-primary hover:underline"
          >
            Open {mission.displayId}
          </Link>
        </div>
      }
    />
  );
}
