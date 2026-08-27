import { deriveObjectiveLifecycleView } from '@overlord/automations/objective-manager';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowRightToLine, Loader2, Sparkles, Unplug } from 'lucide-react';
import { useRef, useState } from 'react';

import type { MissionDetailDto } from '../../shared/contract.ts';
import { objectiveSearchFromLocation } from '../lib/mission-panel-search.ts';
import {
  useGenerateMissionTitle,
  useMission,
  useUpdateMission,
  useUpdateObjective
} from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

import { AgentSessionActivity } from './agent-session/AgentSessionActivity.tsx';
import { MissionObjectivesSection } from './objectives/MissionObjectivesSection.tsx';
import { MissionSchedulingControls } from './scheduling/MissionSchedulingControls.tsx';
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
import { InlineEditField } from './InlineEditField.tsx';
import { LiveActivityFeed } from './LiveActivityFeed.tsx';
import { LiveFileChanges } from './LiveFileChanges.tsx';
import { MissionArtifactsSection } from './MissionArtifactsSection.tsx';
import { MissionDeliveriesSection } from './MissionDeliveriesSection.tsx';
import { MissionMemberSelect } from './MissionMemberSelect.tsx';
import { MissionNotes } from './MissionNotes.tsx';
import { MissionPanelHeader } from './MissionPanelHeader.tsx';
import { MissionProjectSelect } from './MissionProjectSelect.tsx';
import { MissionSharedStateFooter } from './MissionSharedStateFooter.tsx';
import { MissionStatusSelect } from './MissionStatusSelect.tsx';
import { MissionTagSelect } from './MissionTagSelect.tsx';
import { TerminalSessionsSection } from './TerminalSessionsSection.tsx';
import { Button, Spinner } from './ui.tsx';

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
      <MissionSchedulingControls mission={mission} />
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
  /** Override the default close-to-project-board navigation (e.g. My Missions → /user). */
  onClose?: () => void;
  /** Override the default navigation after a cross-project move. */
  onProjectChanged?: (nextProjectId: string) => void;
}) {
  const navigate = useNavigate();
  const focusObjectiveRef = useRouterState({
    select: state => objectiveSearchFromLocation(state.location.search)
  });
  const missionQ = useMission(missionId, { refetchBranchState: true });
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
  const activeObjectiveId =
    deriveObjectiveLifecycleView(mission.objectives, {
      allowParallelObjectives: mission.allowParallelObjectives
    }).activeObjective?.id ?? null;

  return (
    <div className="flex h-full min-h-0 min-w-[375px] flex-col bg-(--color-surface-1)">
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
      <section className="px-5 py-1.5 pt-2">
        <MissionTagSelect
          missionId={mission.id}
          projectId={mission.projectId}
          assignedTags={mission.tags}
        />
      </section>
      <div
        className={cn(
          'scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted',
          isScrolling && 'is-scrolling'
        )}
        onScroll={handleScroll}
      >
        {/* Card section — primary work surface: objectives */}
        <section className="border-b border-(--color-border) bg-(--color-surface-1) pb-5 pt-2">
          <div className="flex flex-col gap-3 px-5 ">
            <MissionObjectivesSection mission={mission} focusObjectiveRef={focusObjectiveRef} />
          </div>
        </section>

        {/* Subtle section — supporting context: notes and activity */}
        <section className="flex flex-col px-5 pt-5 bg-muted h-full pb-10">
          <MissionNotes missionId={mission.id} notes={mission.notes} />
          <Separator />
          <div className="flex flex-col gap-6 mt-8">
            <TerminalSessionsSection
              missionId={mission.id}
              workspaceId={mission.workspaceId}
              sessions={mission.terminalSessions}
              objectives={mission.objectives}
              currentObjectiveId={activeObjectiveId}
            />
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
                Artifacts
              </h2>
              <MissionArtifactsSection missionId={mission.id} />
            </div>
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
                Deliveries
              </h2>
              <MissionDeliveriesSection missionId={mission.id} objectives={mission.objectives} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
                  Activity
                </h2>
                {mission.hasExecutingObjective && <DisconnectActivityButton mission={mission} />}
              </div>
              <LiveActivityFeed missionId={mission.id} />
              <AgentSessionActivity missionId={mission.id} objectiveId={activeObjectiveId} />
            </div>
            <div className="space-y-3 pb-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
                File Changes
              </h2>
              <LiveFileChanges missionId={mission.id} projectId={mission.projectId} />
            </div>{' '}
          </div>
        </section>
      </div>
      <MissionSharedStateFooter missionId={mission.id} />
    </div>
  );
}
