import { useQueryClient } from '@tanstack/react-query';
import { Check, FolderPlus, ListPlus, RotateCcw, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import type {
  HumanActionResolutionDto,
  MissionDetailDto,
  ResolveHumanActionBody
} from '../../shared/contract.ts';
import { api } from '../lib/api.ts';
import {
  keys,
  useCreateMission,
  useCreateObjective,
  useReopenDeferredWork,
  useResolveDeferredWork
} from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

/** Everything needed to address and promote one deferred-work item of a delivery. */
export interface DeferredWorkItemData {
  deliveryId: string;
  actionId: string;
  /** The agent's structured item, verbatim; never rewritten (contract v166). */
  title: string;
  change: string;
  location: string;
  doneWhen: string;
  /** The delivering mission and objective. */
  missionId: string;
  objectiveId: string;
  resolution: HumanActionResolutionDto | null;
}

/**
 * The objective a promotion creates: the item's title, and an instruction of
 * `change`, `Location: …` and `Done when: …` separated by blank lines, verbatim
 * (plan §11 item 6).
 */
export function deferredWorkPromotion(
  item: Pick<DeferredWorkItemData, 'title' | 'change' | 'location' | 'doneWhen'>
): { title: string; instructionText: string } {
  return {
    title: item.title,
    instructionText: `${item.change}\n\nLocation: ${item.location}\n\nDone when: ${item.doneWhen}`
  };
}

export const deferredWorkActionButtonClass =
  'inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white/70 px-2 py-0.5 text-xs font-medium text-violet-800 transition-colors hover:bg-white disabled:opacity-50 dark:border-violet-500/50 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-950/50';

/** Human label for the decision recorded on a deferred-work item. */
export function deferredWorkOutcomeLabel(resolution: HumanActionResolutionDto): string {
  if (resolution.status === 'dismissed') return 'Dismissed';
  const ref = resolution.outcomeRef ? ` ${resolution.outcomeRef}` : '';
  if (resolution.outcome === 'mission_created') return `Mission${ref} created`;
  if (resolution.outcome === 'objective_added') return `Objective${ref} added`;
  return 'Done';
}

function OutcomeIcon({ resolution }: { resolution: HumanActionResolutionDto }) {
  const Icon =
    resolution.status === 'dismissed'
      ? X
      : resolution.outcome === 'mission_created'
        ? FolderPlus
        : resolution.outcome === 'objective_added'
          ? ListPlus
          : Check;
  return <Icon className="size-3" aria-hidden="true" />;
}

export type DeferredWorkPending = 'mission' | 'objective' | 'dismiss' | 'reopen' | null;

/** A mission created by a Create mission promotion. */
export type PromotedMission = {
  id: string;
  displayId: string;
  objectiveDisplayId: string | null;
};

/**
 * The promotion, dismiss and reopen handlers of one deferred-work item, shared
 * by the delivery card and the mission summary's Suggested next rows so both
 * record the same decision through the same mutations.
 */
export function useDeferredWorkActions(
  item: DeferredWorkItemData,
  { onMissionCreated }: { onMissionCreated?: (mission: PromotedMission) => void } = {}
) {
  const qc = useQueryClient();
  const createMission = useCreateMission();
  const createObjective = useCreateObjective();
  const resolve = useResolveDeferredWork();
  const reopen = useReopenDeferredWork();
  const [pending, setPending] = useState<DeferredWorkPending>(null);
  const [error, setError] = useState<string | null>(null);
  // The server answer lands before the delivery/rail queries refetch; show it at once.
  const [localResolution, setLocalResolution] = useState<
    HumanActionResolutionDto | null | undefined
  >(undefined);
  useEffect(() => setLocalResolution(undefined), [item.resolution]);

  const resolution = localResolution === undefined ? item.resolution : localResolution;
  const promotion = deferredWorkPromotion(item);

  async function record(body: ResolveHumanActionBody) {
    const updated = await resolve.mutateAsync({
      deliveryId: item.deliveryId,
      actionId: item.actionId,
      missionId: item.missionId,
      ...body
    });
    setLocalResolution(updated.resolution);
  }

  /** The delivering mission, from cache when a mission panel already loaded it. */
  function loadMission(): Promise<MissionDetailDto> {
    return qc.fetchQuery({
      queryKey: keys.mission(item.missionId),
      queryFn: () => api.getMission(item.missionId)
    });
  }

  function resourceKeyOf(mission: MissionDetailDto): string | null {
    return (
      mission.objectives.find(objective => objective.id === item.objectiveId)?.resourceKey ?? null
    );
  }

  async function run(kind: Exclude<DeferredWorkPending, null>, task: () => Promise<void>) {
    setPending(kind);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  const createMissionFromItem = () =>
    run('mission', async () => {
      const source = await loadMission();
      const resourceKey = resourceKeyOf(source)?.trim();
      const created = await createMission.mutateAsync({
        projectId: source.projectId,
        title: promotion.title,
        objectives: [
          {
            objective: promotion.instructionText,
            title: promotion.title,
            ...(resourceKey ? { resourceKey } : {})
          }
        ]
      });
      await record({ status: 'done', outcome: 'mission_created', outcomeRef: created.displayId });
      onMissionCreated?.({
        id: created.id,
        displayId: created.displayId,
        objectiveDisplayId: created.objectives[0]?.displayId ?? null
      });
    });

  const addObjectiveFromItem = () =>
    run('objective', async () => {
      const source = await loadMission();
      const created = await createObjective.mutateAsync({
        missionId: item.missionId,
        instructionText: promotion.instructionText,
        title: promotion.title,
        state: 'future',
        resourceKey: resourceKeyOf(source)
      });
      await record({ status: 'done', outcome: 'objective_added', outcomeRef: created.displayId });
    });

  const dismiss = () => run('dismiss', () => record({ status: 'dismissed' }));

  const reopenItem = () =>
    run('reopen', async () => {
      const updated = await reopen.mutateAsync({
        deliveryId: item.deliveryId,
        actionId: item.actionId,
        missionId: item.missionId
      });
      setLocalResolution(updated.resolution);
    });

  return {
    resolution,
    pending,
    busy: pending !== null,
    error,
    createMission: createMissionFromItem,
    addObjective: addObjectiveFromItem,
    dismiss,
    reopen: reopenItem
  };
}

/**
 * One deferred-work item from a delivery card (coo:1045). While open it offers
 * Create mission, Add objective, and Dismiss; once handled it fades, drops the
 * buttons, and shows which one was chosen. The decision is recorded in
 * `human_action_resolutions`.
 */
export function DeferredWorkItem({
  item,
  details,
  onMissionCreated,
  className
}: {
  item: DeferredWorkItemData;
  /** Extra context drawn between the text and the controls. */
  details?: ReactNode;
  /** Called with the new mission once a Create mission promotion is recorded. */
  onMissionCreated?: (mission: PromotedMission) => void;
  className?: string;
}) {
  const {
    resolution,
    pending,
    busy,
    error,
    createMission: handleCreateMission,
    addObjective: handleAddObjective,
    dismiss: handleDismiss,
    reopen: handleReopen
  } = useDeferredWorkActions(item, { onMissionCreated });

  return (
    <div className={cn('min-w-0 transition-opacity', resolution && 'opacity-60', className)}>
      <p className="font-medium wrap-anywhere">{item.title}</p>
      <p className="wrap-anywhere">{item.change}</p>
      <p className="mt-0.5 font-mono text-xs wrap-anywhere opacity-80">{item.location}</p>
      <p className="mt-0.5 text-xs wrap-anywhere">
        <span className="font-medium">Done when:</span> {item.doneWhen}
      </p>
      {details}
      {resolution ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-500/20 dark:text-violet-100"
            role="status"
          >
            <OutcomeIcon resolution={resolution} />
            {deferredWorkOutcomeLabel(resolution)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleReopen()}
            title="Reopen"
            aria-label={`Reopen: ${item.title}`}
            className="inline-flex size-5 items-center justify-center rounded text-violet-700 opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40 dark:text-violet-300"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreateMission()}
            className={deferredWorkActionButtonClass}
          >
            <FolderPlus className="size-3.5" aria-hidden="true" />
            {pending === 'mission' ? 'Creating…' : 'Create mission'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAddObjective()}
            className={deferredWorkActionButtonClass}
          >
            <ListPlus className="size-3.5" aria-hidden="true" />
            {pending === 'objective' ? 'Adding…' : 'Add objective'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDismiss()}
            className={deferredWorkActionButtonClass}
          >
            <X className="size-3.5" aria-hidden="true" />
            {pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
