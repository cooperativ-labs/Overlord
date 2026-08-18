import { Link } from '@tanstack/react-router';
import { ArrowRightToLine, EllipsisVertical } from 'lucide-react';

import { CopyMissionIdentifierButton } from '@/components/CopyMissionIdentifierButton';
import { DeleteMissionButton } from '@/components/DeleteMissionButton';
import { MissionTimerPopover } from '@/components/everhour/MissionTimerPopover';
import { MissionBranchControl } from '@/components/MissionBranchControl';
import { OriginSparklesIcon } from '@/components/OriginSparklesIcon.tsx';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { agentDisplayName } from '@/lib/helpers/agent-icons.ts';
import { useUpdateMission, useWorkspaceMembers } from '@/lib/queries.ts';

import type { MissionDetailDto } from '../../shared/contract.ts';

type MissionPanelHeaderProps = {
  mission: MissionDetailDto;
  projectId: string;
  onClose: () => void;
};

/**
 * The full provenance sentence, e.g.
 * *"Created by Claude Code · while working on coo:668 · for Jake"*.
 *
 * The card only has room for a 12px glyph, so this is where provenance is
 * actually legible. Each clause is independently optional: an agent that filed
 * a mission outside a session has no "while working on", and a mission created
 * by an unattached token has nobody to be "for".
 */
function MissionOriginLine({ mission }: { mission: MissionDetailDto }) {
  const membersQ = useWorkspaceMembers(mission.workspaceId);

  if (mission.createdByKind === 'human') return null;

  const author =
    mission.createdByKind === 'automation'
      ? 'Overlord'
      : (agentDisplayName(mission.createdByAgent) ?? 'an agent');
  const onBehalfOf = (membersQ.data ?? []).find(
    member => member.workspaceUserId === mission.createdByWorkspaceUserId
  );
  const onBehalfOfLabel = onBehalfOf
    ? onBehalfOf.displayName?.trim() || onBehalfOf.handle || onBehalfOf.email
    : null;
  const createdFrom = mission.createdFrom;

  return (
    <div className="flex min-w-0 items-center gap-1.5 border-b border-[var(--color-border)] px-4 py-1.5 text-[11px] text-muted-foreground">
      <OriginSparklesIcon />
      <span className="truncate">
        Created by <span className="text-foreground/80">{author}</span>
        {createdFrom ? (
          <>
            {' · while working on '}
            <Link
              to="/projects/$projectId/missions/$missionId"
              params={{ projectId: mission.projectId, missionId: createdFrom.missionId }}
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              onClick={event => event.stopPropagation()}
            >
              {createdFrom.missionDisplayId}
            </Link>
          </>
        ) : null}
        {onBehalfOfLabel ? (
          <>
            {' · for '}
            <span className="text-foreground/80">{onBehalfOfLabel}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}

export function MissionPanelHeader({ mission, projectId, onClose }: MissionPanelHeaderProps) {
  return (
    <div className="shrink-0">
      <MissionPanelHeaderBar mission={mission} projectId={projectId} onClose={onClose} />
      <MissionOriginLine mission={mission} />
    </div>
  );
}

function MissionPanelHeaderBar({ mission, projectId, onClose }: MissionPanelHeaderProps) {
  const update = useUpdateMission(mission.id);

  return (
    <div className="relative flex shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-[var(--color-border)] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Mission actions"
                className="h-7 w-7"
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span>
                Mission ID: <strong>{mission.displayId}</strong>
              </span>
              <CopyMissionIdentifierButton
                value={mission.displayId}
                ariaLabel="Copy full mission identifier"
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm hover:bg-accent"
              />
            </div>
            <DropdownMenuCheckboxItem
              checked={mission.allowParallelObjectives}
              disabled={update.isPending}
              onCheckedChange={checked =>
                update.mutate({ allowParallelObjectives: checked === true })
              }
              onSelect={event => event.preventDefault()}
            >
              Allow parallel objectives
            </DropdownMenuCheckboxItem>
            <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
              Off by default. When on, Run can start a second objective that uses a different
              project resource. Same-resource pairs stay serial.
            </p>
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span>Delete mission</span>
              <DeleteMissionButton
                missionId={mission.id}
                projectId={projectId}
                missionLabel={mission.displayId}
                className="inline-flex h-7 w-7 items-center justify-center"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="truncate text-xs tabular-nums text-muted-foreground">
          {mission.displayId}
        </span>
      </div>

      <div className="flex min-w-0 shrink items-center justify-end gap-2">
        <MissionTimerPopover missionId={mission.id} />
        <MissionBranchControl mission={mission} />

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Close panel"
          onClick={onClose}
        >
          <ArrowRightToLine className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
