import type { MissionDetailDto } from '@overlord/contract';
import type { ObjectiveDto } from '@overlord/contract';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRightToLine, Loader2, Sparkles, Unplug } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useObjectiveDetailNavigation } from '../lib/hooks/use-objective-detail-navigation.ts';
import { findObjectiveByRef } from '../lib/mission-panel-search.ts';
import {
  evidenceTruncationFromPages,
  partitionMissionEvidence
} from '../lib/objective-evidence.ts';
import {
  useGenerateMissionTitle,
  useMission,
  useMissionDeliveries,
  useMissionFileChanges,
  useMissionOpenAgentRequests,
  useMissionSummary,
  useUpdateMission,
  useUpdateObjective
} from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

import { MissionBlockingQuestions } from './mission-panel/MissionBlockingQuestions.tsx';
import { MissionOverviewCard } from './mission-panel/MissionOverviewCard.tsx';
import { ObjectiveDetail } from './objective-detail/ObjectiveDetail.tsx';
import { GhostObjective } from './objectives/GhostObjective.tsx';
import { MissionObjectivesSection } from './objectives/MissionObjectivesSection.tsx';
import { Button as IconButton } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/dialog.tsx';
import { Separator } from './ui/separator.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.tsx';
import {
  deliveryVariantForEligibility,
  MissionDeliveryVariantProvider
} from './DeliverySummaryCard.tsx';
import { InlineEditField } from './InlineEditField.tsx';
import { LiveActivityFeed } from './LiveActivityFeed.tsx';
import { MissionArtifactsSection } from './MissionArtifactsSection.tsx';
import { MissionMemberSelect } from './MissionMemberSelect.tsx';
import { MissionNotes } from './MissionNotes.tsx';
import { MissionPanelHeader } from './MissionPanelHeader.tsx';
import { MissionProjectSelect } from './MissionProjectSelect.tsx';
import { MissionSharedStateFooter } from './MissionSharedStateFooter.tsx';
import { MissionStatusSelect } from './MissionStatusSelect.tsx';
import { MissionTagSelect } from './MissionTagSelect.tsx';
import { MissionLatchSessionProvider } from './ObjectiveTerminalSessions.tsx';
import { Button, Spinner } from './ui.tsx';
import { UnassignedEvidenceSection } from './UnassignedEvidenceSection.tsx';

/** Generates the mission title from its primary objective via the Automations Layer summarizer. */
function GenerateMissionTitleButton({ mission }: { mission: MissionDetailDto }) {
  const generate = useGenerateMissionTitle(mission.id);
  const [justSucceeded, setJustSucceeded] = useState(false);
  const hasObjectiveText = mission.objectives.some(
    objective => objective.instructionText.trim().length > 0
  );
  const disabled = generate.isPending || !hasObjectiveText;

  const handleClick = () => {
    if (disabled) return;
    generate.mutate(undefined, {
      onSuccess: () => {
        setJustSucceeded(true);
        window.setTimeout(() => setJustSucceeded(false), 1200);
      }
    });
  };

  const label = !hasObjectiveText
    ? 'Add an objective before generating a title'
    : generate.isError
      ? (generate.error as Error).message
      : 'Generate title with AI';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Generate title with AI"
            disabled={disabled}
            onClick={handleClick}
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        {generate.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Sparkles
            className={cn(
              'h-5 w-5',
              justSucceeded && 'text-emerald-600',
              generate.isError && 'text-destructive'
            )}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MissionTitle({ mission }: { mission: MissionDetailDto }) {
  const update = useUpdateMission(mission.id);

  return (
    <section className=" px-5 py-3 mt-2">
      <h1 className="flex items-center gap-1 text-xl font-bold leading-snug">
        <InlineEditField
          className="min-w-0 flex-1"
          inputClassName="md:text-lg font-bold"
          value={mission.title}
          ariaLabel="Mission title"
          onSave={title => update.mutate({ title })}
        />
        <GenerateMissionTitleButton mission={mission} />
      </h1>
    </section>
  );
}

function DisconnectActivityButton({ mission }: { mission: MissionDetailDto }) {
  const updateObjective = useUpdateObjective();
  const [open, setOpen] = useState(false);

  const executingObjective = mission.objectives.find(o => o.state === 'executing');
  // Disconnect acts on one objective, so the confirmation names that objective
  // rather than talking about "the mission" (coo:756 §9.2).
  const objectiveLabel = executingObjective
    ? [executingObjective.displayId, executingObjective.title?.trim()].filter(Boolean).join(' — ')
    : '';

  const handleDisconnect = async () => {
    if (!executingObjective) return;
    await updateObjective.mutateAsync({ id: executingObjective.id, body: { state: 'submitted' } });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-(--color-ink-dim) transition-colors hover:bg-destructive/10 hover:text-destructive"
          />
        }
      >
        <Unplug className="h-3 w-3" />
        Disconnect
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect this objective?</DialogTitle>
          <DialogDescription>
            {executingObjective
              ? `Disconnecting moves ${objectiveLabel} back to the queue. Any agent currently running it may no longer be able to report progress back to Overlord.`
              : 'Disconnecting moves the running objective back to the queue. Any agent currently running it may no longer be able to report progress back to Overlord.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={updateObjective.isPending || !executingObjective}
            onClick={handleDisconnect}
          >
            {updateObjective.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The mission's assignment settings — owner, project, and stage — surfaced as a
 * compact row directly beneath the title and above the objectives. These used to
 * live in the panel header; pulling them next to the title groups the mission's
 * "what is this" metadata in one place and frees the header for git controls.
 */
function MissionSettingsBar({
  mission,
  projectId,
  onProjectChanged
}: {
  mission: MissionDetailDto;
  projectId: string;
  onProjectChanged?: (projectId: string) => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-1 px-5 py-1.5">
      <MissionMemberSelect
        missionId={mission.id}
        workspaceId={mission.workspaceId}
        assignedWorkspaceUserId={mission.assignedWorkspaceUserId}
      />
      <MissionProjectSelect
        missionId={mission.id}
        projectId={projectId}
        onProjectChanged={onProjectChanged}
      />
      <MissionStatusSelect
        missionId={mission.id}
        currentStatusId={mission.statusId}
        statuses={mission.statuses}
      />
      <MissionTagSelect
        missionId={mission.id}
        projectId={projectId}
        assignedTags={mission.tags}
      />
    </section>
  );
}

export function MissionPanel({
  projectId,
  missionId,
  onClose,
  onProjectChanged
}: {
  projectId: string;
  missionId: string;
  /** Override the default close-to-project-board navigation (e.g. the Feed drawer). */
  onClose?: () => void;
  /** Override the default navigation after a cross-project move. */
  onProjectChanged?: (nextProjectId: string) => void;
}) {
  const navigate = useNavigate();
  const missionQ = useMission(missionId, { refetchBranchState: true });
  // Deliveries are fetched once per mission and partitioned by objective
  // (coo:879); terminal sessions ride on the mission detail itself. File
  // changes are read per objective from the server (filtered before its cap);
  // the capped mission page only feeds the unassigned-evidence fallback.
  const deliveriesQ = useMissionDeliveries(missionId, true);
  const fileChangesQ = useMissionFileChanges(missionId);
  // Eligibility comes only from the summary envelope (contract v166). Until it
  // loads, or for an older mission, delivery cards keep the full presentation.
  const summaryQ = useMissionSummary(missionId);
  const deliveryVariant = deliveryVariantForEligibility(summaryQ.data?.eligible);
  const evidence = useMemo(
    () =>
      partitionMissionEvidence({
        objectives: missionQ.data?.objectives ?? [],
        deliveries: deliveriesQ.data?.items,
        fileChanges: fileChangesQ.data?.items,
        terminalSessions: missionQ.data?.terminalSessions
      }),
    [
      deliveriesQ.data?.items,
      fileChangesQ.data?.items,
      missionQ.data?.objectives,
      missionQ.data?.terminalSessions
    ]
  );
  const evidenceTruncation = useMemo(
    () =>
      evidenceTruncationFromPages({
        deliveries: deliveriesQ.data,
        fileChanges: fileChangesQ.data
      }),
    [deliveriesQ.data, fileChangesQ.data]
  );
  const evidenceLoading = useMemo(
    () => ({
      deliveries: deliveriesQ.isLoading,
      deliveriesUnavailable: !deliveriesQ.isSuccess || deliveriesQ.isFetching
    }),
    [deliveriesQ.isLoading, deliveriesQ.isSuccess, deliveriesQ.isFetching]
  );
  // One complete open-request collection shared by the question slot, the overview badge and
  // For you, the row tints and the detail (plan §3.2); loading ignores summary eligibility.
  const openRequests = useMissionOpenAgentRequests(missionId);
  const objectiveNav = useObjectiveDetailNavigation();
  /** The objective the composer is still committing; hidden from the rows until it hands over. */
  const [committingObjectiveId, setCommittingObjectiveId] = useState<string | null>(null);
  /** Row order for the detail's "n of m" and previous/next. */
  const [rowOrder, setRowOrder] = useState<string[]>([]);
  /** "Edit title" from a row menu: the detail opens with that objective's title editor. */
  const [titleEditObjectiveId, setTitleEditObjectiveId] = useState<string | null>(null);
  /** The row button or link that opened the detail, for focus return on close. */
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const lastOpenObjectiveIdRef = useRef<string | null>(null);
  const openObjectiveId =
    findObjectiveByRef(missionQ.data?.objectives ?? [], objectiveNav.currentRef)?.id ?? null;
  if (openObjectiveId) lastOpenObjectiveIdRef.current = openObjectiveId;

  const openObjective = useCallback(
    (objective: ObjectiveDto, options?: { trigger: HTMLElement | null }) => {
      detailOpenerRef.current = options?.trigger ?? null;
      objectiveNav.open(objective.displayId || objective.id);
    },
    [objectiveNav]
  );
  const openObjectiveByRef = useCallback(
    (objectiveRef: string, trigger: HTMLElement | null) => {
      detailOpenerRef.current = trigger;
      objectiveNav.open(objectiveRef);
    },
    [objectiveNav]
  );
  const getReturnFocusTarget = useCallback((): HTMLElement | null => {
    const opener = detailOpenerRef.current;
    if (opener?.isConnected) return opener;
    const lastId = lastOpenObjectiveIdRef.current;
    const row = lastId
      ? document.querySelector<HTMLElement>(`[data-objective-id="${CSS.escape(lastId)}"] button`)
      : null;
    if (row) return row;
    // The row was deleted: return to the objective list itself.
    return document.querySelector<HTMLElement>('[data-mission-objective-list]');
  }, []);
  const clearTitleEdit = useCallback(() => setTitleEditObjectiveId(null), []);

  const [isScrolling, setIsScrolling] = useState(false);
  const scrollIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleScroll = () => {
    setIsScrolling(true);
    clearTimeout(scrollIdleTimeoutRef.current);
    scrollIdleTimeoutRef.current = setTimeout(() => setIsScrolling(false), 800);
  };

  const handleProjectChanged = (nextProjectId: string) => {
    if (onProjectChanged) {
      onProjectChanged(nextProjectId);
      return;
    }
    navigate({
      to: '/projects/$projectId/missions/$missionId',
      params: { projectId: nextProjectId, missionId }
    });
  };

  const closeToProject = (targetProjectId: string) => {
    if (onClose) {
      onClose();
      return;
    }
    navigate({ to: '/projects/$projectId', params: { projectId: targetProjectId } });
  };

  if (missionQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner />
      </div>
    );
  }

  if (missionQ.isError || !missionQ.data) {
    return (
      <div className="flex h-full flex-col p-4">
        <div className="mb-3">
          <Button
            variant="ghost"
            aria-label="Close mission panel"
            onClick={() => closeToProject(projectId)}
          >
            <ArrowRightToLine className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-red-400">
          Could not load mission: {(missionQ.error as Error)?.message ?? 'not found'}
        </p>
      </div>
    );
  }

  const mission = missionQ.data;

  return (
    // Both providers wrap the header as well as the body: the Latch chip lives in the header
    // (plan §4, §10).
    <MissionLatchSessionProvider
      missionId={mission.id}
      workspaceId={mission.workspaceId}
      sessions={mission.terminalSessions}
    >
      <MissionDeliveryVariantProvider value={deliveryVariant}>
        {/* Container for the header's narrow-panel sizing (plan §10). */}
        <div className="@container/mission-panel flex h-full min-h-0 min-w-[375px] flex-col bg-(--color-surface-1)">
          <MissionPanelHeader
            mission={mission}
            projectId={mission.projectId}
            onClose={() => closeToProject(mission.projectId)}
          />
          <MissionTitle mission={mission} />

          <MissionSettingsBar
            mission={mission}
            projectId={mission.projectId}
            onProjectChanged={handleProjectChanged}
          />
          <div
            className={cn(
              'scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted',
              isScrolling && 'is-scrolling'
            )}
            onScroll={handleScroll}
          >
            {/* Open blocking questions, directly under the title (plan §5). */}
            <MissionBlockingQuestions
              mission={mission}
              openRequests={openRequests}
              onOpenObjective={openObjectiveByRef}
            />
            {/*
              The overview card and the sticky composer share one wrapper (plan §4, §8). The
              wrapper has no height and no overflow of its own, so the composer sticks to the
              bottom of the scroll viewport only while the card extends below it, then settles
              beneath the card: the end of every tab stays reachable.
            */}
            <div className="px-3 pt-3" data-mission-overview-wrapper="">
              <MissionOverviewCard
                key={mission.id}
                mission={mission}
                openRequests={openRequests}
                occluded={openObjectiveId !== null}
                objectiveList={
                  <MissionObjectivesSection
                    mission={mission}
                    committingObjectiveId={committingObjectiveId}
                    openObjectiveId={openObjectiveId}
                    onOpenObjective={openObjective}
                    onEditObjectiveTitle={objective => {
                      setTitleEditObjectiveId(objective.id);
                      openObjective(objective);
                    }}
                    onObjectiveDeleted={objective => {
                      if (objective.id === openObjectiveId) objectiveNav.close();
                    }}
                    onRowOrderChange={setRowOrder}
                  />
                }
              />
              {/* The composer: present on every tab, never remounted by a tab change (plan §8). */}
              <div className="sticky bottom-0 z-10 py-3" data-mission-composer="">
                <GhostObjective
                  missionId={mission.id}
                  projectId={mission.projectId}
                  onCommittingChange={setCommittingObjectiveId}
                />
              </div>
            </div>
            {/* The objective detail, mounted once at panel level (plan §4, §9). */}
            <ObjectiveDetail
              mission={mission}
              rowOrder={rowOrder}
              evidence={evidence}
              evidenceLoading={evidenceLoading}
              evidenceTruncation={evidenceTruncation}
              titleEditObjectiveId={titleEditObjectiveId}
              onTitleEditHandled={clearTitleEdit}
              getReturnFocusTarget={getReturnFocusTarget}
            />

            {/* Subtle section — supporting context: notes, artifacts, and activity */}
            <section className="flex flex-col px-5 pt-5 bg-muted h-full pb-10">
              <MissionNotes missionId={mission.id} notes={mission.notes} />
              <Separator />
              <div className="flex flex-col gap-6 mt-8">
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
                    Artifacts
                  </h2>
                  <MissionArtifactsSection missionId={mission.id} objectives={mission.objectives} />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
                      Activity
                    </h2>
                    {mission.hasExecutingObjective && (
                      <DisconnectActivityButton mission={mission} />
                    )}
                  </div>
                  <LiveActivityFeed missionId={mission.id} />
                </div>
                {deliveriesQ.isError || fileChangesQ.isError ? (
                  <p className="text-sm text-red-400">
                    Could not load objective evidence:{' '}
                    {((deliveriesQ.error ?? fileChangesQ.error) as Error)?.message ??
                      'unknown error'}
                  </p>
                ) : null}
                <div className="pb-5">
                  <UnassignedEvidenceSection
                    projectId={mission.projectId}
                    evidence={evidence.unassigned}
                    fileChanges={evidence.unassignedFileChanges}
                    truncation={evidenceTruncation}
                  />
                </div>
              </div>
            </section>
          </div>
          <MissionSharedStateFooter missionId={mission.id} />
        </div>
      </MissionDeliveryVariantProvider>
    </MissionLatchSessionProvider>
  );
}
