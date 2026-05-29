'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AddTicketObjectiveButton } from '@/components/features/AddTicketObjectiveButton';
import { DraftObjective } from '@/components/features/DraftObjective';
import { ObjectiveCollapsibleItem } from '@/components/features/ObjectiveCollapsibleItem';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import { clearAwaitingApprovalAction, reorderFutureObjectivesAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import type { LaunchAgentType } from '@/lib/helpers/agent-types';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import {
  sortObjectivesByCreatedAtAscending,
  sortObjectivesByPositionThenCreatedAt
} from '@/lib/objectives';
import type { AgentCommands } from '@/lib/overlord/launch-commands';
import { cn } from '@/lib/utils';
import type { ObjectiveRow } from '@/types/objectives';
import type { TicketAssignedAgent } from '@/types/tickets';

const reorderFutureObjectivesActionWithRetry = withElectronActionRetry(
  reorderFutureObjectivesAction
);

type ObjectiveSessionResume = {
  agentIdentifier: string;
  externalSessionId: string | null;
};

type TicketObjectivesSectionProps = {
  ticketId: string;
  organizationId?: number;
  objectives: ObjectiveRow[];
  futureObjectivesEnabled?: boolean;
  objectiveAttachments: ObjectiveAttachment[];
  objectiveFileMentionPaths: string[];
  workingDirectory: string | null;
  assignedAgent?: TicketAssignedAgent | null;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentType, string[]>>;
  agentPreCommands?: Partial<Record<LaunchAgentType, string>>;
  agentCommands?: AgentCommands;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  sshEnabled?: boolean;
  hasProjectWorkingDirectory?: boolean;
  sessionsByObjectiveId?: Record<string, ObjectiveSessionResume>;
};

type SharedObjectiveItemProps = {
  ticketId: string;
  organizationId?: number;
  objectiveAttachments: ObjectiveAttachment[];
  objectiveFileMentionPaths: string[];
  workingDirectory: string | null;
  assignedAgent?: TicketAssignedAgent | null;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentType, string[]>>;
  agentPreCommands?: Partial<Record<LaunchAgentType, string>>;
  agentCommands?: AgentCommands;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  sshEnabled?: boolean;
  hasProjectWorkingDirectory?: boolean;
};

function ObjectiveEditableItem({
  objective,
  shared
}: {
  objective: ObjectiveRow;
  shared: SharedObjectiveItemProps;
}) {
  return (
    <DraftObjective
      canMarkExecuted={Boolean(objective.objective?.trim())}
      fileMentionPaths={shared.objectiveFileMentionPaths}
      initialAutoAdvance={objective.auto_advance !== false}
      initialValue={objective.objective ?? ''}
      initialAttachments={shared.objectiveAttachments.filter(
        attachment => attachment.objectiveId === objective.id
      )}
      objectiveId={objective.id}
      objectiveState={objective.state}
      ticketId={shared.ticketId}
      organizationId={shared.organizationId}
      workingDirectory={shared.workingDirectory}
      assignedAgent={
        parseObjectiveAssignedAgent(objective.assigned_agent) ?? shared.assignedAgent ?? null
      }
      projectId={shared.projectId}
      agentFlags={shared.agentFlags}
      agentPreCommands={shared.agentPreCommands}
      agentCommands={shared.agentCommands}
      sshCommand={shared.sshCommand}
      remoteWorkingDirectory={shared.remoteWorkingDirectory}
      sshEnabled={shared.sshEnabled}
      hasProjectWorkingDirectory={shared.hasProjectWorkingDirectory}
    />
  );
}

function SortableFutureObjective({
  objective,
  shared
}: {
  objective: ObjectiveRow;
  shared: SharedObjectiveItemProps;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: objective.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('relative flex items-stretch gap-2', isDragging && 'z-10 opacity-70')}
    >
      <button
        type="button"
        aria-label="Reorder future objective"
        className="flex w-5 shrink-0 cursor-grab items-center justify-center self-stretch rounded text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <ObjectiveEditableItem objective={objective} shared={shared} />
      </div>
    </div>
  );
}

function AwaitingApprovalBanner({
  objective,
  ticketId
}: {
  objective: ObjectiveRow;
  ticketId: string;
}) {
  const [pending, setPending] = useState(false);

  const handleDismiss = async () => {
    if (pending) return;
    setPending(true);
    try {
      await clearAwaitingApprovalAction({ ticketId, objectiveId: objective.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear approval gate.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        Waiting for your approval to continue.
      </p>
      {objective.approval_reason ? (
        <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">{objective.approval_reason}</p>
      ) : (
        <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
          This objective is queued for your review.
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={handleDismiss}
          disabled={pending}
          className="text-xs text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
        >
          Dismiss approval gate
        </button>
        <span className="text-[11px] text-amber-900/60 dark:text-amber-200/60">
          (then start the objective normally)
        </span>
      </div>
    </div>
  );
}

export function TicketObjectivesSection({
  ticketId,
  organizationId,
  objectives: initialObjectives,
  futureObjectivesEnabled = false,
  objectiveAttachments,
  objectiveFileMentionPaths,
  workingDirectory,
  assignedAgent,
  projectId,
  agentFlags,
  agentPreCommands,
  agentCommands,
  sshCommand,
  remoteWorkingDirectory,
  sshEnabled,
  hasProjectWorkingDirectory,
  sessionsByObjectiveId = {}
}: TicketObjectivesSectionProps) {
  const objectives = useTicketObjectivesRealtime({
    ticketId,
    initialObjectives
  });

  const nonFutureEditable = useMemo(
    () =>
      sortObjectivesByCreatedAtAscending(
        objectives.filter(
          objective => objective.state === 'draft' || objective.state === 'submitted'
        )
      ),
    [objectives]
  );

  const futureObjectivesFromServer = useMemo(
    () =>
      sortObjectivesByPositionThenCreatedAt(
        objectives.filter(objective => futureObjectivesEnabled && objective.state === 'future')
      ),
    [futureObjectivesEnabled, objectives]
  );

  // Locally-mirrored order for optimistic drag-and-drop updates. We sync from
  // the server whenever the set of future objective ids changes; mid-drag
  // realtime updates that only shuffle positions are ignored to avoid the
  // dragged item jumping back to its previous slot before our update lands.
  const [futureOrder, setFutureOrder] = useState<string[]>(() =>
    futureObjectivesFromServer.map(objective => objective.id)
  );

  useEffect(() => {
    const incomingIds = futureObjectivesFromServer.map(objective => objective.id);
    setFutureOrder(previous => {
      const previousSet = new Set(previous);
      const incomingSet = new Set(incomingIds);
      const sameMembership =
        previous.length === incomingIds.length && previous.every(id => incomingSet.has(id));
      if (sameMembership) {
        return previous;
      }
      // Preserve any locally-known ordering for ids still present, then
      // append any newcomers in server position order.
      const kept = previous.filter(id => incomingSet.has(id));
      const additions = incomingIds.filter(id => !previousSet.has(id));
      return [...kept, ...additions];
    });
  }, [futureObjectivesFromServer]);

  const orderedFutureObjectives = useMemo(() => {
    const byId = new Map(futureObjectivesFromServer.map(objective => [objective.id, objective]));
    return futureOrder
      .map(id => byId.get(id))
      .filter((objective): objective is ObjectiveRow => Boolean(objective));
  }, [futureObjectivesFromServer, futureOrder]);

  const lastEditable =
    orderedFutureObjectives[orderedFutureObjectives.length - 1] ??
    nonFutureEditable[nonFutureEditable.length - 1];
  const hasTrailingEmptyDraft =
    (lastEditable?.state === 'draft' ||
      (futureObjectivesEnabled && lastEditable?.state === 'future')) &&
    (lastEditable?.objective ?? '').trim() === '';

  const hasAnyDraftObjective = useMemo(
    () => objectives.some(objective => objective.state === 'draft'),
    [objectives]
  );

  const executedObjectives = objectives.filter(
    objective =>
      objective.state !== 'draft' &&
      (!futureObjectivesEnabled || objective.state !== 'future') &&
      objective.state !== 'submitted' &&
      objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByPositionThenCreatedAt(executedObjectives);

  const hasEditable = nonFutureEditable.length > 0 || orderedFutureObjectives.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const oldIndex = futureOrder.indexOf(activeId);
    const newIndex = futureOrder.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextOrder = arrayMove(futureOrder, oldIndex, newIndex);
    setFutureOrder(nextOrder);

    try {
      await reorderFutureObjectivesActionWithRetry({
        ticketId,
        orderedObjectiveIds: nextOrder
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder objectives.');
      // Revert on failure.
      setFutureOrder(futureObjectivesFromServer.map(objective => objective.id));
    }
  }

  const shared: SharedObjectiveItemProps = {
    ticketId,
    organizationId,
    objectiveAttachments,
    objectiveFileMentionPaths,
    workingDirectory,
    assignedAgent,
    projectId,
    agentFlags,
    agentPreCommands,
    agentCommands,
    sshCommand,
    remoteWorkingDirectory,
    sshEnabled,
    hasProjectWorkingDirectory
  };

  return (
    <div className="flex flex-col pb-5">
      <div className="px-5">
        {orderedExecutedObjectives.length > 0 ? (
          <>
            <div className="mb-3 space-y-2 rounded-md border bg-background">
              {orderedExecutedObjectives.map((objective, index) => (
                <ObjectiveCollapsibleItem
                  key={objective.id}
                  objective={objective}
                  index={index}
                  ticketId={ticketId}
                  attachments={objectiveAttachments.filter(
                    attachment => attachment.objectiveId === objective.id
                  )}
                  workingDirectory={workingDirectory}
                  resumeAgentIdentifier={
                    sessionsByObjectiveId[objective.id]?.agentIdentifier ??
                    objective.agent_identifier
                  }
                  externalSessionId={sessionsByObjectiveId[objective.id]?.externalSessionId ?? null}
                />
              ))}
            </div>
          </>
        ) : null}

        {!hasEditable ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted-foreground">No objectives yet.</p>
            <AddTicketObjectiveButton
              ticketId={ticketId}
              futureObjectivesEnabled={futureObjectivesEnabled}
            />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {nonFutureEditable.map(objective => (
                <div key={objective.id} className="space-y-2">
                  {objective.state === 'draft' && objective.approval_reason ? (
                    <AwaitingApprovalBanner objective={objective} ticketId={ticketId} />
                  ) : null}
                  <ObjectiveEditableItem objective={objective} shared={shared} />
                </div>
              ))}
              {orderedFutureObjectives.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={orderedFutureObjectives.map(objective => objective.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-3">
                      {orderedFutureObjectives.map(objective => (
                        <SortableFutureObjective
                          key={objective.id}
                          objective={objective}
                          shared={shared}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : null}
            </div>
            <div className="mt-3">
              <AddTicketObjectiveButton
                futureObjectivesEnabled={futureObjectivesEnabled}
                disabled={
                  hasTrailingEmptyDraft || (!futureObjectivesEnabled && hasAnyDraftObjective)
                }
                ticketId={ticketId}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
