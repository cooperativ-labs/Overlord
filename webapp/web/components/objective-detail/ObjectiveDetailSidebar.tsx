import type { MissionDetailDto, ObjectiveDto, TerminalSessionDto } from '@overlord/contract';
import { Clock, FolderOpen, GitBranch, Sparkles, Unplug, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { getAgentIcon } from '../../lib/helpers/agent-icons.ts';
import { objectiveOriginLabel } from '../../lib/mission-origin.ts';
import { formatObjectiveElapsed } from '../../lib/objective-evidence.ts';
import { projectResourceLabel } from '../../lib/project-resources.ts';
import { useProjectResources, useUpdateObjective } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { AgentIcon } from '../objectives/AgentIcon.tsx';
import { AgentLaunchButton } from '../objectives/AgentLaunchButton.tsx';
import { AgentModelChooserButton } from '../objectives/AgentModelChooserButton.tsx';
import { resolveLaunchSiblingGuard } from '../objectives/launch-sibling-guard.ts';
import { ObjectiveQueuePopover } from '../objectives/ObjectiveQueuePopover.tsx';
import { ObjectiveResourcePicker } from '../objectives/ObjectiveResourcePicker.tsx';
import { isNotStartedObjective } from '../objectives/ObjectiveRow.tsx';
import type { useObjectiveAgentSelection } from '../objectives/useObjectiveAgentSelection.ts';
import { ObjectiveTerminalSessions } from '../ObjectiveTerminalSessions.tsx';
import { describeQueueEntry } from '../run-queue/queue-entry-status.ts';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog.tsx';

import { detailPrimaryAction } from './objective-detail-model.ts';

export type ObjectiveAgentSelectionState = ReturnType<typeof useObjectiveAgentSelection>;

/** States whose Run Queue control can add an entry (plan §7.2 #7). */
const QUEUEABLE_STATES = new Set<ObjectiveDto['state']>([
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery'
]);

function SidebarBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="min-w-0 text-sm text-(--color-ink)">{children}</div>
    </div>
  );
}

/** "<agent> · <model>" from the objective's own workspace catalog. */
export function agentModelLabel(
  objective: ObjectiveDto,
  catalog: ObjectiveAgentSelectionState['catalog']
): string {
  const agent = catalog?.agents.find(a => a.key === objective.assignedAgent);
  const model = agent?.models.find(m => m.id === objective.model);
  const agentLabel = agent?.label ?? objective.assignedAgent ?? 'Manual';
  const modelLabel = model?.displayName ?? objective.model;
  return modelLabel ? `${agentLabel} · ${modelLabel}` : agentLabel;
}

export function ObjectiveAgentMark({ objective }: { objective: ObjectiveDto }) {
  const hasIcon = objective.assignedAgent ? getAgentIcon(objective.assignedAgent) !== null : false;
  return hasIcon && objective.assignedAgent ? (
    <AgentIcon agentKey={objective.assignedAgent} size={14} alt="" className="size-3.5 shrink-0" />
  ) : (
    <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
  );
}

/** Started / completed / running duration, as one line. */
export function objectiveTimingLabel(objective: ObjectiveDto, nowIso: string): string | null {
  if (objective.state === 'complete') {
    const elapsed = formatObjectiveElapsed({
      startedAt: objective.startedAt,
      completedAt: objective.completedAt
    });
    const at = objective.completedAt ? new Date(objective.completedAt).toLocaleString() : null;
    if (at) return elapsed ? `Completed ${at} · ${elapsed}` : `Completed ${at}`;
    return null;
  }
  if (objective.startedAt) {
    const elapsed = formatObjectiveElapsed({ startedAt: objective.startedAt, completedAt: nowIso });
    return elapsed
      ? `Running for ${elapsed}`
      : `Started ${new Date(objective.startedAt).toLocaleString()}`;
  }
  return null;
}

/** The objective's resource label, or null when the project has a single resource. */
export function useObjectiveResourceLabel(objective: ObjectiveDto): string | null {
  const resourcesQ = useProjectResources(objective.projectId);
  const resources = resourcesQ.data ?? [];
  if (resources.length <= 1 || !objective.resourceKey) return null;
  return projectResourceLabel({ resources, resourceKey: objective.resourceKey });
}

/** Force disconnect with the existing confirmation copy (plan §9.4 primary action). */
export function ForceDisconnectButton({
  objective,
  className
}: {
  objective: ObjectiveDto;
  className?: string;
}) {
  const update = useUpdateObjective();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        <Unplug aria-hidden="true" />
        Force disconnect
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force disconnect this objective?</DialogTitle>
            <DialogDescription>
              This ends Overlord&apos;s active session and clears its pending launch. The objective
              returns to the top of the draft queue. Its deliveries, file changes, and terminal
              session are kept as previous runs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={update.isPending}
              onClick={() =>
                void update
                  .mutateAsync({ id: objective.id, body: { state: 'draft' } })
                  .then(() => setOpen(false))
              }
            >
              {update.isPending ? 'Disconnecting…' : 'Force disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Run, with the existing parallel-launch guard and an awaited save boundary before launch. */
export function ObjectiveRunButton({
  objective,
  mission,
  selection,
  beforeLaunch,
  size = 'sm'
}: {
  objective: ObjectiveDto;
  mission: MissionDetailDto;
  selection: ObjectiveAgentSelectionState;
  beforeLaunch: () => Promise<boolean>;
  size?: 'sm' | 'default';
}) {
  const resourcesQ = useProjectResources(objective.projectId);
  const primaryResourceKey =
    resourcesQ.data?.find(resource => resource.isPrimary)?.resourceKey ?? 'primary';
  const guard = resolveLaunchSiblingGuard({
    objective,
    siblings: mission.objectives,
    executionRequests: mission.executionRequests,
    allowParallelObjectives: mission.allowParallelObjectives,
    primaryResourceKey
  });
  return (
    <div className="inline-flex rounded-md border border-border">
      <AgentLaunchButton
        objective={objective}
        selection={selection.selection}
        selectionLoaded={selection.loaded}
        hasActiveSibling={guard.hasBlockingSibling}
        activeSiblingId={guard.activeSiblingId}
        activeRequest={guard.activeRequest}
        beforeLaunch={beforeLaunch}
        size={size}
      />
    </div>
  );
}

/**
 * The right column of the objective detail (plan §9.4): agent and model, resource, branch,
 * timing and origin, the Run Queue, the current terminal session and the primary action. On
 * narrow viewports the same content is the "Details" disclosure (plan §9.5).
 */
export function ObjectiveDetailSidebar({
  objective,
  mission,
  selection,
  latestSessions,
  beforeLaunch,
  queueOpen,
  onQueueOpenChange,
  showPrimaryAction = true,
  className
}: {
  objective: ObjectiveDto;
  mission: MissionDetailDto;
  selection: ObjectiveAgentSelectionState;
  /** The latest run's terminal sessions, newest first. */
  latestSessions: readonly TerminalSessionDto[];
  beforeLaunch: () => Promise<boolean>;
  /** Run Queue popover state, shared with the menu's "Add to queue…". */
  queueOpen: boolean;
  onQueueOpenChange: (open: boolean) => void;
  /** The mobile bottom bar carries the primary action itself. */
  showPrimaryAction?: boolean;
  className?: string;
}) {
  const update = useUpdateObjective();
  const resourcesQ = useProjectResources(objective.projectId);
  const resourceLabel = useObjectiveResourceLabel(objective);
  const notStarted = isNotStartedObjective(objective.state);
  const origin = objectiveOriginLabel(objective);
  const timing = objectiveTimingLabel(objective, new Date().toISOString());
  const queueEntry = objective.queueEntry ?? null;
  const queueStatus = queueEntry ? describeQueueEntry(queueEntry) : null;
  const showQueue = queueEntry !== null || QUEUEABLE_STATES.has(objective.state);
  const primary = detailPrimaryAction(objective.state);

  return (
    <div className={cn('grid min-w-0 content-start gap-4', className)}>
      <SidebarBlock label="Agent">
        {notStarted ? (
          <AgentModelChooserButton
            catalog={selection.catalog}
            selection={selection.selection}
            onChange={selection.setSelection}
            agentConfigs={selection.agentConfigs}
            onLaunchConfigCommit={selection.commitLaunchConfig}
            onUseInheritedDefault={selection.useInheritedLaunchConfig}
            launchConfigSourceHint={selection.launchConfigSourceHint}
          />
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ObjectiveAgentMark objective={objective} />
            <span className="truncate">{agentModelLabel(objective, selection.catalog)}</span>
          </span>
        )}
      </SidebarBlock>

      {notStarted && (resourcesQ.data?.length ?? 0) > 1 ? (
        <SidebarBlock label="Resource">
          <ObjectiveResourcePicker
            resources={resourcesQ.data ?? []}
            value={objective.resourceKey}
            disabled={update.isPending}
            onChange={resourceKey => update.mutate({ id: objective.id, body: { resourceKey } })}
          />
        </SidebarBlock>
      ) : resourceLabel ? (
        <SidebarBlock label="Resource">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{resourceLabel}</span>
          </span>
        </SidebarBlock>
      ) : null}

      {objective.branch || timing || origin ? (
        <div className="grid min-w-0 gap-1.5 text-xs text-(--color-ink-dim)">
          {objective.branch ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono" title={objective.branch}>
                {objective.branch}
              </span>
            </span>
          ) : null}
          {timing ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{timing}</span>
            </span>
          ) : null}
          {origin ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{origin}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {showQueue ? (
        <SidebarBlock label="Run Queue">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-(--color-ink-dim)">
              {queueEntry && queueStatus
                ? `${queueStatus.label} · ${queueEntry.queueName}`
                : 'Not queued'}
            </span>
            {/* The popover's own trigger lives here, inside the detail: every queue control the
                detail opens (including the menu's "Add to queue…") anchors to it, never to a
                row behind the modal. */}
            <ObjectiveQueuePopover
              objective={objective}
              open={queueOpen}
              onOpenChange={onQueueOpenChange}
              triggerClassName="h-7 w-7 justify-center px-0"
            />
          </span>
        </SidebarBlock>
      ) : null}

      {latestSessions.length > 0 ? (
        <SidebarBlock label="Terminal session">
          <ObjectiveTerminalSessions
            sessions={latestSessions}
            emptyState={<span className="text-xs text-(--color-ink-dim)">No live session</span>}
          />
        </SidebarBlock>
      ) : null}

      {showPrimaryAction && primary === 'run' ? (
        <ObjectiveRunButton
          objective={objective}
          mission={mission}
          selection={selection}
          beforeLaunch={beforeLaunch}
        />
      ) : null}
      {showPrimaryAction && primary === 'force-disconnect' ? (
        <ForceDisconnectButton objective={objective} className="justify-self-start" />
      ) : null}
    </div>
  );
}
