import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';

import { DueDatePickerButton } from '@/components/scheduling/DueDatePickerButton.tsx';
import { useMission, useUpdateMission } from '@/lib/queries.ts';
import { cn } from '@/lib/utils';

import type { InboxMissionDto, MissionDetailDto } from '../../../shared/contract.ts';
import {
  MissionCompleteCheckbox,
  MissionDueDateBadge,
  MissionOriginMark
} from '../../pages/MissionCardPrimitives.tsx';

import { dueSoonLabel, overdueLabel } from './inbox-task-groups.ts';

/** Small project chip shared by both mission-row flavours. */
function ProjectChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="hidden max-w-[140px] shrink-0 items-center gap-1.5 truncate rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline-flex"
      title={name}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[3px] border"
        style={{ backgroundColor: color ?? undefined, borderColor: color ?? undefined }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

function MissionRowShell({
  title,
  completed,
  projectColor,
  onComplete,
  onActivate,
  ariaLabel,
  subtitle,
  trailing,
  expanded,
  isExpanded
}: {
  title: string;
  completed: boolean;
  projectColor: string | null;
  onComplete?: () => void;
  onActivate: () => void;
  ariaLabel: string;
  subtitle?: ReactNode;
  trailing: ReactNode;
  expanded?: ReactNode;
  isExpanded?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-expanded={expanded !== undefined ? Boolean(isExpanded) : undefined}
        onClick={onActivate}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
          }
        }}
        className={cn(
          'group relative flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isExpanded && 'bg-muted/30'
        )}
      >
        <MissionCompleteCheckbox
          color={projectColor}
          completed={completed}
          onComplete={onComplete}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'min-w-0 truncate text-sm font-semibold leading-snug text-foreground',
                completed && 'text-muted-foreground line-through'
              )}
            >
              {title}
            </span>
          </div>
          {subtitle ? (
            <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>

        {/* Portaled picker content bubbles through the React tree; keep it off the row. */}
        <div
          className="flex shrink-0 items-center gap-2"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          {trailing}
        </div>
      </div>
      {expanded ? <div className="mb-2 ml-8 mr-2 mt-1">{expanded}</div> : null}
    </div>
  );
}

/**
 * A cross-workspace triage mission (agent-filed Next work, overdue, or due
 * soon) drawn as a task-list row. Missions already live in a project, so the
 * row opens the mission page rather than an inline editor; the checkbox
 * completes it in place when its project has a `complete` status.
 */
export function InboxTriageMissionRow({
  mission,
  onComplete
}: {
  mission: InboxMissionDto;
  onComplete?: (missionId: string) => void;
}) {
  const navigate = useNavigate();
  const reason = triageReasonLabel(mission);

  return (
    <MissionRowShell
      title={mission.title}
      completed={mission.statusType === 'complete'}
      projectColor={mission.projectColor}
      onComplete={onComplete ? () => onComplete(mission.id) : undefined}
      onActivate={() =>
        void navigate({ to: '/user/missions/$missionId', params: { missionId: mission.id } })
      }
      ariaLabel={`Open ${mission.displayId}: ${mission.title}`}
      subtitle={reason}
      trailing={
        <>
          <ProjectChip name={mission.projectName} color={mission.projectColor} />
          <span
            className="font-mono text-[11px] tabular-nums text-muted-foreground"
            title={`Mission ID: ${mission.displayId}`}
          >
            {mission.displayId}
          </span>
          <MissionDueDateBadge dueDatetime={mission.dueDatetime} />
          <MissionOriginMark
            createdByKind={mission.createdByKind}
            createdByAgent={mission.createdByAgent}
          />
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        </>
      }
    />
  );
}

/**
 * Why a triage mission is in the Inbox, most urgent first. `recent` is a
 * modifier rather than a reason, and the agent name rides along for
 * agent-filed work so the row explains itself without a tooltip.
 */
export function triageReasonLabel(mission: InboxMissionDto): string {
  const parts: string[] = [];
  if (mission.reasons.includes('overdue')) {
    parts.push(overdueLabel(mission.dueDatetime) ?? 'Overdue');
  }
  if (mission.reasons.includes('due_soon')) {
    parts.push(dueSoonLabel(mission.dueDatetime) ?? 'Due soon');
  }
  if (mission.reasons.includes('agent_next')) parts.push('Agent Next');
  if (mission.reasons.includes('recent')) parts.push('Recent');
  if (mission.createdByKind === 'agent' && mission.createdByAgent) {
    parts.push(mission.createdByAgent);
  }
  return parts.join(' · ');
}

/**
 * A capture that was just assigned a project on this visit. It stays in the
 * list as a mission row so the eye does not lose it, and expands into the
 * promoted card so agent, resource, and Run are still one click away.
 */
export function InboxPromotedMissionRow({
  mission: initialMission,
  projectName,
  projectColor,
  isExpanded,
  onToggleExpanded,
  onComplete,
  expanded
}: {
  mission: MissionDetailDto;
  projectName: string;
  projectColor: string | null;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onComplete?: () => void;
  expanded: ReactNode;
}) {
  const missionQ = useMission(initialMission.id);
  const mission = missionQ.data ?? initialMission;
  const updateMission = useUpdateMission(mission.id);

  return (
    <MissionRowShell
      title={mission.title}
      completed={mission.statusType === 'complete'}
      projectColor={projectColor}
      onComplete={onComplete}
      onActivate={onToggleExpanded}
      ariaLabel={`${isExpanded ? 'Collapse' : 'Open'} ${mission.displayId}: ${mission.title}`}
      subtitle={`Assigned to ${projectName} · stays here until you leave Inbox`}
      isExpanded={isExpanded}
      expanded={isExpanded ? expanded : null}
      trailing={
        <>
          <ProjectChip name={projectName} color={projectColor} />
          <span
            className="font-mono text-[11px] tabular-nums text-muted-foreground"
            title={`Mission ID: ${mission.displayId}`}
          >
            {mission.displayId}
          </span>
          <DueDatePickerButton
            size="badge"
            emptyLabel="Set due date"
            heading="Due date"
            description="Schedule when this mission is due."
            value={mission.dueDatetime}
            onChange={async next => {
              await updateMission.mutateAsync({ dueDatetime: next });
            }}
          />
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </span>
        </>
      }
    />
  );
}
