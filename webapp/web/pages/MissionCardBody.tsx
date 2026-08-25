import { ListOrdered } from 'lucide-react';

import { MissionTagPill } from '@/components/MissionTagPill.tsx';
import { describeQueueEntry } from '@/components/run-queue/queue-entry-status.ts';
import { CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils.ts';

import type { MissionDto, WorkspaceMemberDto } from '../../shared/contract.ts';
import { useProjectRunQueues } from '../lib/queries.ts';

import { getMissionTags } from './board-shared.ts';
import { MissionCardHoverFooter } from './MissionCardHoverFooter.tsx';
import {
  MissionAssigneeSummary,
  MissionDueDateBadge,
  MissionOriginMark,
  ProjectColorDot
} from './MissionCardPrimitives.tsx';
import { MissionCardState } from './missionCardState.ts';
import { MissionDraftResourceBadge } from './MissionDraftResourceBadge.tsx';

export function MissionCardBody({
  mission,
  projectId,
  projectName,
  projectColor,
  assignee,
  cardState
}: {
  mission: MissionDto;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  assignee?: WorkspaceMemberDto | null;
  cardState: MissionCardState;
}) {
  const tags = getMissionTags(mission);
  const runQueues = useProjectRunQueues(projectId);
  // Entries for this mission can live in several queues; keep each queue's own
  // order and read them left to right, which is the order the queues dispatch in.
  const missionEntries = (runQueues.data?.queues ?? []).flatMap(queue =>
    queue.entries.filter(entry => entry.missionId === mission.id)
  );
  const queuedCount = missionEntries.length;
  const queueStatuses = missionEntries.map(entry => ({
    entry,
    status: describeQueueEntry(entry)
  }));
  const blockedCount = queueStatuses.filter(item => item.status.tone === 'blocked').length;
  const nextUp = queueStatuses.find(item => item.status.tone !== 'blocked')?.entry ?? null;

  return (
    <CardContent className="flex h-full flex-col p-0 font-body">
      <div className="px-3">
        <div className="min-w-0">
          <h4 className="font-body text-sm font-medium leading-snug text-foreground">
            {mission.title}
          </h4>

          <MissionDraftResourceBadge
            projectId={projectId}
            draftObjectiveResourceKey={mission.draftObjectiveResourceKey}
            className="mt-1.5"
          />

          {tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {tags.map(tag => (
                <MissionTagPill key={tag.id} label={tag.label} />
              ))}
            </div>
          ) : null}

          <div
            className={cn(
              'flex items-end justify-between gap-2',
              tags.length > 0 ? 'mt-2' : 'mt-4'
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <ProjectColorDot color={projectColor} name={projectName} />
              <span className="truncate text-[11px] text-muted-foreground">{projectName}</span>
              <MissionOriginMark
                createdByKind={mission.createdByKind}
                createdByAgent={mission.createdByAgent}
              />
            </div>
            <div className="flex min-w-0 max-w-[55%] shrink items-center justify-end gap-2">
              <MissionDueDateBadge dueDatetime={mission.dueDatetime} />
              {queuedCount > 0 ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        className={cn(
                          'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium',
                          blockedCount > 0
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        )}
                      >
                        <ListOrdered className="h-3 w-3" />
                        {queuedCount}
                      </span>
                    }
                  />
                  <TooltipContent>
                    <span className="block">
                      {queuedCount} objective{queuedCount === 1 ? '' : 's'} queued
                    </span>
                    {nextUp ? (
                      <span className="block">
                        Next up in Run Queue: {nextUp.objectiveDisplayId}
                      </span>
                    ) : null}
                    {blockedCount > 0 ? (
                      <span className="block">
                        {blockedCount} blocked — needs attention in the Run Queue
                      </span>
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {cardState.objectiveCount > 0 ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          'pointer-events-auto flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-medium tabular-nums ',
                          cardState.objectiveCountAlert
                            ? 'bg-red-700 dark:bg-red-900 text-white'
                            : 'bg-muted text-muted-foreground'
                        )}
                        onClick={e => e.stopPropagation()}
                      >
                        {cardState.objectiveCount}
                      </div>
                    }
                  />
                  <TooltipContent>
                    {cardState.objectiveCountAlert
                      ? 'Number of completed objectives in this mission. Red means an objective has not been submitted.'
                      : 'Number of completed objectives in this mission.'}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <MissionAssigneeSummary assignee={assignee} />
            </div>
          </div>
        </div>
      </div>

      <div className="h-2" />

      <MissionCardHoverFooter
        missionId={mission.id}
        projectId={projectId}
        displayId={mission.displayId}
        assignedTagIds={tags.map(tag => tag.id)}
      />
    </CardContent>
  );
}
