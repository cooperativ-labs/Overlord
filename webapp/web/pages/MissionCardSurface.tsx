import { useNavigate } from '@tanstack/react-router';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { MissionDto, WorkspaceMemberDto } from '../../shared/contract.ts';

import { MissionCardBody } from './MissionCardBody.tsx';
import { getMissionCardState } from './missionCardState.ts';
import { MissionCardStateOverlay } from './MissionCardStateOverlay.tsx';

/**
 * The clickable card chrome shared by the static (`MissionCard`) and sortable
 * (`SortableMissionCard`) board cards: the bordered `Card`, the derived
 * state overlay, the body, and the navigate-to-mission click handler. Keeping
 * this in one place means both card variants stay visually in sync.
 */
export function MissionCardSurface({
  mission,
  projectId,
  projectName,
  projectColor,
  assignee,
  selected,
  size,
  className
}: {
  mission: MissionDto;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  assignee?: WorkspaceMemberDto | null;
  selected?: boolean;
  size?: 'default' | 'sm';
  className?: string;
}) {
  const navigate = useNavigate();
  const cardState = getMissionCardState(mission);

  return (
    <Card
      aria-label={`Open mission: ${mission.title}`}
      size={size}
      className={cn(
        'group relative overflow-hidden rounded-md border-gray-300/60 bg-linear-to-br from-gray-300/5 over:from-gray-300/20  to-transparent transition-all hover:shadow-md dark:border-gray-700/40',
        selected && 'border-gray-600/60 bg-gray-100/90 dark:border-gray-500/70 dark:bg-gray-900/40',
        className
      )}
      onClick={() =>
        navigate({
          to: '/projects/$projectId/missions/$missionId',
          params: { projectId, missionId: mission.id }
        })
      }
    >
      <MissionCardStateOverlay state={cardState} />
      <MissionCardBody
        mission={mission}
        projectId={projectId}
        projectName={projectName}
        projectColor={projectColor}
        assignee={assignee}
        cardState={cardState}
      />
    </Card>
  );
}
