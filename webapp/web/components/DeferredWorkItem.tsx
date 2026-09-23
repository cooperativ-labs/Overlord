import { useQueryClient } from '@tanstack/react-query';
import { Check, FolderPlus, ListPlus, RotateCcw, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import type {
  HumanActionResolutionDto,
  MissionDetailDto,
  ResolveHumanActionBody
} from '../../shared/contract.ts';
import { api } from '../lib/api.ts';
import { firstObjectiveCreatePayload } from '../lib/project-resources.ts';
import {
  keys,
  useCreateMission,
  useCreateObjective,
  useReopenHumanAction,
  useResolveHumanAction
} from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

/** Everything needed to address and promote one deferred-work item of a delivery. */
export interface DeferredWorkItemData {
  deliveryId: string;
  actionId: string;
  /** The delivery's own text; never rewritten. */
  action: string;
  /** The delivering mission and objective. */
  missionId: string;
  objectiveId: string;
  resolution: HumanActionResolutionDto | null;
}

type Pending = 'mission' | 'objective' | 'dismiss' | 'reopen' | null;

const actionButtonClass =
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

/**
 * One deferred-work item from a delivery, with the same state on every surface
 * that shows it — the delivery card and the Feed's Human actions rail
 * (coo:1045). While open it offers Create mission, Add objective, and Dismiss;
 * once handled it fades, drops the buttons, and shows which one was chosen. The
 * decision is recorded in `human_action_resolutions`, so both surfaces agree.
 */
export function DeferredWorkItem({
  item,
  details,
  onMissionCreated,
  className
}: {
  item: DeferredWorkItemData;
  /** Extra context drawn between the text and the controls (the rail's meta line). */
  details?: ReactNode;
  /** Called with the new mission once a Create mission promotion is recorded. */
  onMissionCreated?: (mission: {
    id: string;
    displayId: string;
    objectiveDisplayId: string | null;
  }) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const createMission = useCreateMission();
  const createObjective = useCreateObjective();
  const resolve = useResolveHumanAction();
  const reopen = useReopenHumanAction();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  // The server answer lands before the delivery/rail queries refetch; show it at once.
  const [localResolution, setLocalResolution] = useState<
    HumanActionResolutionDto | null | undefined
  >(undefined);
  useEffect(() => setLocalResolution(undefined), [item.resolution]);

  const resolution = localResolution === undefined ? item.resolution : localResolution;
  const instructionText = item.action.trim();

  async function record(body: ResolveHumanActionBody) {
    const updated = await resolve.mutateAsync({
      deliveryId: item.deliveryId,
      actionId: item.actionId,
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

  async function run(kind: Exclude<Pending, null>, task: () => Promise<void>) {
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

  const handleCreateMission = () =>
    run('mission', async () => {
      const source = await loadMission();
      const created = await createMission.mutateAsync({
        projectId: source.projectId,
        ...firstObjectiveCreatePayload(instructionText, resourceKeyOf(source))
      });
      await record({ status: 'done', outcome: 'mission_created', outcomeRef: created.displayId });
      onMissionCreated?.({
        id: created.id,
        displayId: created.displayId,
        objectiveDisplayId: created.objectives[0]?.displayId ?? null
      });
    });

  const handleAddObjective = () =>
    run('objective', async () => {
      const source = await loadMission();
      const created = await createObjective.mutateAsync({
        missionId: item.missionId,
        instructionText,
        state: 'future',
        resourceKey: resourceKeyOf(source)
      });
      await record({ status: 'done', outcome: 'objective_added', outcomeRef: created.displayId });
    });

  const handleDismiss = () => run('dismiss', () => record({ status: 'dismissed' }));

  const handleReopen = () =>
    run('reopen', async () => {
      const updated = await reopen.mutateAsync({
        deliveryId: item.deliveryId,
        actionId: item.actionId
      });
      setLocalResolution(updated.resolution);
    });

  const busy = pending !== null;

  return (
    <div className={cn('min-w-0 transition-opacity', resolution && 'opacity-60', className)}>
      <p className="wrap-anywhere">{item.action}</p>
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
            aria-label={`Reopen: ${item.action}`}
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
            className={actionButtonClass}
          >
            <FolderPlus className="size-3.5" aria-hidden="true" />
            {pending === 'mission' ? 'Creating…' : 'Create mission'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAddObjective()}
            className={actionButtonClass}
          >
            <ListPlus className="size-3.5" aria-hidden="true" />
            {pending === 'objective' ? 'Adding…' : 'Add objective'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDismiss()}
            className={actionButtonClass}
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
