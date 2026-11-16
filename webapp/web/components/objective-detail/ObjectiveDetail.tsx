import type { MissionDetailDto, ObjectiveDto, TerminalSessionDto } from '@overlord/contract';
import { useBlocker } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Loader2,
  X
} from 'lucide-react';
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { useAnswerFollowUps } from '../../lib/answered-agent-requests.ts';
import { useDismissedAgentRequests } from '../../lib/dismissed-agent-requests.ts';
import { buildAgentResumeCommand } from '../../lib/helpers/agent-resume-command.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import { useIsMobile } from '../../lib/hooks/use-mobile.ts';
import { useObjectiveDetailNavigation } from '../../lib/hooks/use-objective-detail-navigation.ts';
import { useOpenLatchSession } from '../../lib/latch-session-client.ts';
import { findObjectiveByRef, objectiveSearchFromLocation } from '../../lib/mission-panel-search.ts';
import {
  flushObjectiveEdits,
  isEscapeConsumed,
  useObjectiveEditBuffer
} from '../../lib/objective-edit-buffers.ts';
import {
  evidenceForObjective,
  groupEvidenceByRun,
  type MissionEvidencePartition,
  type ObjectiveEvidenceTruncation,
  objectiveHasHistory
} from '../../lib/objective-evidence.ts';
import {
  useMissionOpenAgentRequests,
  useObjectiveFileChanges,
  useUpdateObjective
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { InlineEditField } from '../InlineEditField.tsx';
import {
  ObjectiveAttachmentList,
  ObjectiveAttachmentUploadTrigger,
  useObjectiveAttachmentState
} from '../objectives/ObjectiveAttachments.tsx';
import {
  type ObjectiveEvidenceLoading,
  ObjectiveEvidenceSections
} from '../objectives/ObjectiveEvidenceSections.tsx';
import { ObjectiveMenuButton } from '../objectives/ObjectiveMenuButton.tsx';
import {
  isInFlightObjective,
  isNotStartedObjective,
  objectiveRowTitle
} from '../objectives/ObjectiveRow.tsx';
import { ObjectiveStateIcon } from '../objectives/ObjectiveStateIcon.tsx';
import { useObjectiveAgentSelection } from '../objectives/useObjectiveAgentSelection.ts';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';
import { FileDropZone } from '../ui/file-drop-zone.tsx';

import { AnsweredAgentRequestCard, DismissibleAgentRequestCard } from './AgentRequestCards.tsx';
import {
  adjacentObjectiveId,
  detailPrimaryAction,
  detailStateBadge,
  objectivePosition
} from './objective-detail-model.ts';
import { ObjectiveBlockingQuestions } from './ObjectiveBlockingQuestions.tsx';
import {
  agentModelLabel,
  ForceDisconnectButton,
  ObjectiveAgentMark,
  type ObjectiveAgentSelectionState,
  ObjectiveDetailSidebar,
  ObjectiveRunButton,
  objectiveTimingLabel,
  useObjectiveResourceLabel
} from './ObjectiveDetailSidebar.tsx';
import { type EmptyDraftGuard, ObjectiveDetailTabs } from './ObjectiveDetailTabs.tsx';

/**
 * Desktop container size (plan §9.2): nearly full height, at most 960px wide, no padding, the
 * header owns the close button. A class constant here, not a variant of the shared dialog.
 */
export const OBJECTIVE_DETAIL_DESKTOP_CLASS =
  'flex h-[calc(100dvh-48px)] w-[min(960px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none';

/**
 * Below 768px the same dialog covers the viewport (plan §9.2, §9.5). The shared dialog centres
 * with `top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` and caps width with
 * `max-w-[calc(100%-2rem)] sm:max-w-sm`; every one of those is neutralised here, not just
 * overridden by inset and size, so nothing is clipped at 640–767px. Safe-area insets pad the
 * edges; the bottom bar pads the bottom inset itself.
 */
export const OBJECTIVE_DETAIL_MOBILE_CLASS =
  'inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ring-0 sm:max-w-none [&_button]:min-h-11 [&_button]:min-w-11';

export type ObjectiveDetailProps = {
  mission: MissionDetailDto;
  /** Objective ids in the panel's row order ("n of m", previous/next). */
  rowOrder: readonly string[];
  evidence: MissionEvidencePartition;
  evidenceLoading: ObjectiveEvidenceLoading;
  evidenceTruncation: ObjectiveEvidenceTruncation;
  /** Open this objective's title editor (the row menu's "Edit title"). */
  titleEditObjectiveId?: string | null;
  /** Called once the detail stops showing the requested title edit. */
  onTitleEditHandled?: () => void;
  /** Where focus returns on close: the invoking row or link, else the objective list. */
  getReturnFocusTarget?: () => HTMLElement | null;
};

/**
 * The objective detail (mission-panel-redesign plan §9), mounted once per mission panel. Which
 * objective is open is the `?objective=` search parameter (display id or UUID); every open,
 * step and close goes through {@link useObjectiveDetailNavigation}.
 *
 * Edits are keyed by objective id in the edit-buffer store. Close, previous/next, browser Back
 * (via a router blocker) and Run all await {@link flushObjectiveEdits} first; a failed save keeps
 * the detail open with the text, the error and a retry.
 */
export function ObjectiveDetail({
  mission,
  rowOrder,
  evidence,
  evidenceLoading,
  evidenceTruncation,
  titleEditObjectiveId = null,
  onTitleEditHandled,
  getReturnFocusTarget
}: ObjectiveDetailProps) {
  const nav = useObjectiveDetailNavigation();
  const isMobile = useIsMobile();
  const objective = findObjectiveByRef(mission.objectives, nav.currentRef);
  /** Set while our own close is in flight, so the invalid-ref cleanup does not race it. */
  const closingRef = useRef(false);
  const [saveBlocked, setSaveBlocked] = useState(false);

  // The mission loaded successfully (the panel mounts the detail only then), so a ref that names
  // no objective of this mission is a stale or wrong link: drop it with replace.
  useEffect(() => {
    if (!nav.currentRef) {
      closingRef.current = false;
      return;
    }
    if (!objective && !closingRef.current) nav.clearInvalid();
  }, [nav, objective]);

  const objectiveId = objective?.id ?? null;
  const previousObjectiveIdRef = useRef(objectiveId);
  useEffect(() => {
    const previous = previousObjectiveIdRef.current;
    previousObjectiveIdRef.current = objectiveId;
    if (previous === objectiveId) return;
    setSaveBlocked(false);
    // The requested title edit ends once the detail leaves that objective (close or step).
    if (titleEditObjectiveId && previous === titleEditObjectiveId) onTitleEditHandled?.();
  }, [objectiveId, onTitleEditHandled, titleEditObjectiveId]);

  const flush = useCallback(async () => {
    if (!objectiveId) return true;
    const ok = await flushObjectiveEdits(objectiveId);
    setSaveBlocked(!ok);
    return ok;
  }, [objectiveId]);

  const requestClose = useCallback(async () => {
    if (!(await flush())) return;
    closingRef.current = true;
    nav.close();
  }, [flush, nav]);

  const requestStep = useCallback(
    async (delta: -1 | 1) => {
      if (!objectiveId) return;
      const targetId = adjacentObjectiveId(rowOrder, objectiveId, delta);
      const target = mission.objectives.find(o => o.id === targetId);
      if (!target) return;
      if (!(await flush())) return;
      nav.step(target.displayId || target.id);
    },
    [flush, mission.objectives, nav, objectiveId, rowOrder]
  );

  // Browser Back/Forward and any other navigation away from this objective: save first, and
  // stay when the save fails (the text is retained either way).
  const titleBuffer = useObjectiveEditBuffer(objectiveId ?? '', 'title');
  const instructionBuffer = useObjectiveEditBuffer(objectiveId ?? '', 'instruction');
  const hasEdits = Boolean(objectiveId && (titleBuffer || instructionBuffer));
  useBlocker({
    disabled: !hasEdits,
    enableBeforeUnload: hasEdits,
    shouldBlockFn: async ({ current, next }) => {
      const nextRef = objectiveSearchFromLocation(next.search);
      if (next.pathname === current.pathname && nextRef === nav.currentRef) return false;
      return !(await flush());
    }
  });

  const open = objective !== null;
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const titleEditorRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const editTitle = objective !== null && titleEditObjectiveId === objective.id;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        // An editor or nested popup that consumed this Escape keeps the detail open: the first
        // Escape cancels the editor or closes the popup, a later one closes the detail.
        if (details.reason === 'escape-key' && isEscapeConsumed(details.event)) {
          details.cancel();
          return;
        }
        details.cancel();
        void requestClose();
      }}
    >
      {objective ? (
        <DialogContent
          showCloseButton={false}
          className={isMobile ? OBJECTIVE_DETAIL_MOBILE_CLASS : OBJECTIVE_DETAIL_DESKTOP_CLASS}
          initialFocus={() => (editTitle ? titleEditorRef.current : headingRef.current)}
          finalFocus={() => getReturnFocusTarget?.() ?? true}
          data-testid="objective-detail"
        >
          <ObjectiveDetailBody
            key={objective.id}
            mission={mission}
            objective={objective}
            rowOrder={rowOrder}
            evidence={evidence}
            evidenceLoading={evidenceLoading}
            evidenceTruncation={evidenceTruncation}
            isMobile={isMobile}
            editTitle={editTitle}
            headingRef={headingRef}
            titleEditorRef={titleEditorRef}
            saveBlocked={saveBlocked}
            beforeLaunch={flush}
            onClose={() => void requestClose()}
            onStep={delta => void requestStep(delta)}
            onDeleted={() => {
              closingRef.current = true;
              nav.close();
            }}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type BodyProps = {
  mission: MissionDetailDto;
  objective: ObjectiveDto;
  rowOrder: readonly string[];
  evidence: MissionEvidencePartition;
  evidenceLoading: ObjectiveEvidenceLoading;
  evidenceTruncation: ObjectiveEvidenceTruncation;
  isMobile: boolean;
  editTitle: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  titleEditorRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  saveBlocked: boolean;
  beforeLaunch: () => Promise<boolean>;
  onClose: () => void;
  onStep: (delta: -1 | 1) => void;
  onDeleted: () => void;
};

/** Everything inside the dialog for one objective; keyed by objective id so local state resets. */
function ObjectiveDetailBody(props: BodyProps) {
  const { objective, evidence, isMobile } = props;
  const selection = useObjectiveAgentSelection(objective);
  const [queueOpen, setQueueOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const objectiveEvidence = evidenceForObjective(evidence, objective.id);
  const runs = groupEvidenceByRun(objectiveEvidence, objective, { keepEmptyLatest: true });
  const latestSessions = runs[0]?.terminalSessions ?? [];

  const openQueueFromMenu = () => {
    if (isMobile) setDetailsOpen(true);
    // Let the menu finish closing so its dismissal is not an outside press on the popover.
    setTimeout(() => setQueueOpen(true), 0);
  };

  const shared = {
    ...props,
    selection,
    latestSessions,
    queueOpen,
    setQueueOpen,
    openQueueFromMenu,
    detailsOpen,
    setDetailsOpen
  };
  return isMobile ? <MobileLayout {...shared} /> : <DesktopLayout {...shared} />;
}

type LayoutProps = BodyProps & {
  selection: ObjectiveAgentSelectionState;
  latestSessions: readonly TerminalSessionDto[];
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
  openQueueFromMenu: () => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
};

function useBlockedState(mission: MissionDetailDto, objective: ObjectiveDto) {
  const openRequests = useMissionOpenAgentRequests(mission.id);
  const requests = openRequests.blockingByObjective.get(objective.id) ?? [];
  return {
    openRequests,
    requests,
    blocked: isInFlightObjective(objective.state) && requests.length > 0
  };
}

function DesktopLayout(props: LayoutProps) {
  const { mission, objective } = props;
  const { blocked } = useBlockedState(mission, objective);
  return (
    <>
      <DetailHeader {...props} blocked={blocked} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-8 pt-4 wrap-anywhere">
          <DetailMainColumn {...props} />
        </div>
        <aside
          aria-label="Objective details"
          className="w-[272px] shrink-0 overflow-y-auto border-l border-(--color-border) bg-(--color-surface-2) p-4"
        >
          <ObjectiveDetailSidebar
            objective={objective}
            mission={mission}
            selection={props.selection}
            latestSessions={props.latestSessions}
            beforeLaunch={props.beforeLaunch}
            queueOpen={props.queueOpen}
            onQueueOpenChange={props.setQueueOpen}
          />
        </aside>
      </div>
    </>
  );
}

function MobileLayout(props: LayoutProps) {
  const { mission, objective, rowOrder } = props;
  const { blocked } = useBlockedState(mission, objective);
  const position = objectivePosition(rowOrder, objective.id);
  const badge = detailStateBadge(objective.state, blocked);
  const resourceLabel = useObjectiveResourceLabel(objective);
  const timing = objectiveTimingLabel(objective, new Date().toISOString());

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-(--color-border) px-2 py-1">
        <button
          type="button"
          onClick={props.onClose}
          aria-label={`Back to ${mission.title}`}
          className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-sm text-(--color-ink) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{mission.title}</span>
        </button>
        {position ? (
          <span className="shrink-0 px-1 text-xs tabular-nums text-(--color-ink-dim)">
            {`${position.index + 1} of ${position.total}`}
          </span>
        ) : null}
        <DetailMenu {...props} triggerClassName="size-11" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 wrap-anywhere">
        <div className="flex flex-wrap items-center gap-2">
          <IdentifierButton objective={objective} className="min-h-11" />
          <StateBadge
            label={badge.label}
            tone={badge.tone}
            state={objective.state}
            blocked={blocked}
          />
        </div>
        <DetailTitle {...props} />
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-ink-dim)">
          <span className="inline-flex items-center gap-1">
            <ObjectiveAgentMark objective={objective} />
            {agentModelLabel(objective, props.selection.catalog)}
          </span>
          {resourceLabel ? <span>{resourceLabel}</span> : null}
          {objective.branch ? <span className="font-mono">{objective.branch}</span> : null}
          {timing ? <span>{timing}</span> : null}
        </p>
        <details
          className="mt-2 rounded-md border border-(--color-border)"
          open={props.detailsOpen}
          onToggle={event => props.setDetailsOpen(event.currentTarget.open)}
        >
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
            Details
          </summary>
          <div className="border-t border-(--color-border) p-3">
            <ObjectiveDetailSidebar
              objective={objective}
              mission={mission}
              selection={props.selection}
              latestSessions={props.latestSessions}
              beforeLaunch={props.beforeLaunch}
              queueOpen={props.queueOpen}
              onQueueOpenChange={props.setQueueOpen}
              showPrimaryAction={false}
            />
            {objective.state === 'executing' ? (
              <ForceDisconnectButton objective={objective} className="mt-3 min-h-11" />
            ) : null}
          </div>
        </details>
        <div className="mt-4">
          <DetailMainColumn {...props} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-(--color-border) bg-(--color-surface-1) px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <IconControl
          label="Previous objective"
          disabled={rowOrder.length < 2}
          onClick={() => props.onStep(-1)}
          className="size-11"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </IconControl>
        <div className="flex min-w-0 flex-1 justify-center">
          <MobilePrimaryAction {...props} />
        </div>
        <IconControl
          label="Next objective"
          disabled={rowOrder.length < 2}
          onClick={() => props.onStep(1)}
          className="size-11"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </IconControl>
      </div>
    </>
  );
}

/** Run, or "Open in Latch" when the objective has a session (plan §9.5). */
function MobilePrimaryAction(props: LayoutProps) {
  const { objective, latestSessions } = props;
  const primary = detailPrimaryAction(objective.state);
  const session = latestSessions[0];
  if (primary === 'run') {
    return (
      <ObjectiveRunButton
        objective={objective}
        mission={props.mission}
        selection={props.selection}
        beforeLaunch={props.beforeLaunch}
        size="default"
      />
    );
  }
  if (session) return <OpenInLatchButton session={session} />;
  return null;
}

function OpenInLatchButton({ session }: { session: TerminalSessionDto }) {
  const open = useOpenLatchSession(session);
  return (
    <div className="grid justify-items-center gap-0.5">
      <button
        type="button"
        onClick={() => open.mutate()}
        disabled={open.isPending}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-(--color-border) px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {open.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ExternalLink className="size-4" aria-hidden="true" />
        )}
        Open in Latch
      </button>
      {open.isError ? (
        <p role="alert" className="text-[11px] text-destructive">
          {open.error instanceof Error ? open.error.message : 'Could not open the session.'}
        </p>
      ) : null}
    </div>
  );
}

function DetailHeader(props: LayoutProps & { blocked: boolean }) {
  const { objective, rowOrder, blocked } = props;
  const position = objectivePosition(rowOrder, objective.id);
  const badge = detailStateBadge(objective.state, blocked);
  return (
    <header className="shrink-0 border-b border-(--color-border) px-5 pb-3 pt-3">
      <div className="flex min-w-0 items-center gap-2">
        <IdentifierButton objective={objective} />
        <StateBadge
          label={badge.label}
          tone={badge.tone}
          state={objective.state}
          blocked={blocked}
        />
        {position ? (
          <span className="text-xs tabular-nums text-(--color-ink-dim)">
            {`${position.index + 1} of ${position.total}`}
          </span>
        ) : null}
        <span className="flex-1" />
        <IconControl
          label="Previous objective"
          disabled={rowOrder.length < 2}
          onClick={() => props.onStep(-1)}
        >
          <ChevronUp className="size-4" aria-hidden="true" />
        </IconControl>
        <IconControl
          label="Next objective"
          disabled={rowOrder.length < 2}
          onClick={() => props.onStep(1)}
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </IconControl>
        <DetailMenu {...props} />
        <IconControl label="Close objective" onClick={props.onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconControl>
      </div>
      <DetailTitle {...props} />
    </header>
  );
}

/** The dialog's accessible name and the title editor (keyboard-operable via its edit button). */
function DetailTitle(props: LayoutProps) {
  const { objective } = props;
  const update = useUpdateObjective();
  return (
    <>
      <DialogTitle
        ref={props.headingRef}
        tabIndex={-1}
        className="mt-2 text-lg font-semibold leading-snug text-(--color-ink) outline-none"
      >
        <InlineEditField
          buffer={{ objectiveId: objective.id, field: 'title' }}
          autoEdit={props.editTitle}
          editorRef={props.titleEditorRef}
          value={objective.title ?? ''}
          placeholder={objectiveRowTitle(objective)}
          ariaLabel="Objective title"
          editButtonLabel="Edit title"
          commitEmpty
          inputClassName="text-lg font-semibold md:text-lg"
          onSave={title =>
            update.mutateAsync({
              id: objective.id,
              body: { title: title.length > 0 ? title : null }
            })
          }
        />
      </DialogTitle>
      {props.saveBlocked ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Some edits could not be saved. Retry or discard them before leaving this objective.
        </p>
      ) : null}
    </>
  );
}

function DetailMenu(props: LayoutProps & { triggerClassName?: string }) {
  const { objective } = props;
  const canAddToQueue =
    !objective.queueEntry &&
    ['draft', 'submitted', 'launching', 'executing', 'pending_delivery'].includes(objective.state);
  return (
    <ObjectiveMenuButton
      objectiveId={objective.id}
      displayId={objective.displayId}
      state={objective.state}
      resumeCommand={buildAgentResumeCommand({
        agent: objective.assignedAgent,
        sessionId: objective.externalSessionId
      })}
      sessionId={objective.externalSessionId}
      onOpenAddToQueue={canAddToQueue ? props.openQueueFromMenu : undefined}
      showForceDisconnect
      onDeleted={props.onDeleted}
      triggerClassName={props.triggerClassName}
    />
  );
}

/**
 * The left column (plan §9.4): undismissed request notifications (in flight), Summary and
 * Instructions, attachments, Blocking questions, then deliveries, file changes and earlier runs.
 */
function DetailMainColumn(props: LayoutProps) {
  const { mission, objective, evidence } = props;
  const { openRequests, requests, blocked } = useBlockedState(mission, objective);
  const { dismissedIds, dismiss } = useDismissedAgentRequests(
    { workspaceId: mission.workspaceId, missionId: mission.id },
    {
      openRequestIds: openRequests.requests.map(request => request.id),
      authoritative: openRequests.authoritative
    }
  );
  const notStarted = isNotStartedObjective(objective.state);
  const inFlight = isInFlightObjective(objective.state);
  const attachmentState = useObjectiveAttachmentState(objective.id);
  const fileChangesQuery = useObjectiveFileChanges(objective.missionId, objective.id, {
    enabled: objective.startedAt !== null
  });
  const objectiveEvidence = evidenceForObjective(evidence, objective.id);
  const fileCount = fileChangesQuery.data?.total ?? 0;
  const hasHistory = objectiveHasHistory(objectiveEvidence, fileCount);
  const historyKnown =
    !props.evidenceLoading.deliveries &&
    !props.evidenceLoading.deliveriesUnavailable &&
    !props.evidenceTruncation.deliveries &&
    (objective.startedAt === null || (fileChangesQuery.isSuccess && !fileChangesQuery.isFetching));
  const emptyDraftGuard: EmptyDraftGuard =
    !attachmentState.attachmentsKnown || attachmentState.isUploading || !historyKnown
      ? null
      : { attachmentCount: attachmentState.attachments.length, hasHistory };
  const topCards = inFlight ? requests.filter(request => !dismissedIds.has(request.id)) : [];
  const answerFollowUps = useAnswerFollowUps(mission.id, objective.id);
  const openIds = new Set(openRequests.requests.map(request => request.id));
  const answeredCards = inFlight
    ? answerFollowUps.followUps.filter(request => !openIds.has(request.id))
    : [];
  const evidenceMode = inFlight ? 'active' : objective.state === 'complete' ? 'complete' : null;

  return (
    <div className="grid min-w-0 gap-5">
      {topCards.length > 0 || answeredCards.length > 0 ? (
        <div className="grid min-w-0 gap-2">
          {topCards.map(request => (
            <DismissibleAgentRequestCard key={request.id} request={request} onDismiss={dismiss} />
          ))}
          {answeredCards.map(request => (
            <AnsweredAgentRequestCard
              key={request.id}
              request={request}
              onClose={answerFollowUps.close}
            />
          ))}
        </div>
      ) : null}

      <ObjectiveDetailTabs
        key={objective.id}
        objective={objective}
        emptyDraftGuard={emptyDraftGuard}
        onObjectiveDeleted={props.onDeleted}
      />

      {notStarted ? (
        <FileDropZone
          onDrop={attachmentState.handleFiles}
          disabled={attachmentState.isUploading}
          dragState={attachmentState.dragState}
          className="min-w-0 rounded-md border border-dashed border-(--color-border)"
        >
          <DetailSectionLabel className="px-3 pt-2">Attachments</DetailSectionLabel>
          <ObjectiveAttachmentList
            attachments={attachmentState.attachments}
            removingId={attachmentState.removingId}
            onRemove={attachmentState.handleRemove}
            toolbar
          />
          {attachmentState.error ? (
            <p role="alert" className="px-3 pb-1 text-xs text-destructive">
              {attachmentState.error}
            </p>
          ) : null}
          <ObjectiveAttachmentUploadTrigger
            attachmentsCount={attachmentState.attachments.length}
            inputRef={attachmentState.inputRef}
            onInputChange={attachmentState.handleInputChange}
            disabled={attachmentState.isUploading}
          >
            <span className="text-xs text-(--color-ink-dim)">
              {attachmentState.isUploading ? 'Uploading…' : 'Drop files here or use +'}
            </span>
          </ObjectiveAttachmentUploadTrigger>
        </FileDropZone>
      ) : attachmentState.attachments.length > 0 ? (
        <div className="grid min-w-0 gap-1">
          <DetailSectionLabel>Attachments</DetailSectionLabel>
          <ObjectiveAttachmentList
            attachments={attachmentState.attachments}
            readOnly
            className="-ml-2"
          />
        </div>
      ) : null}

      <ObjectiveBlockingQuestions
        requests={requests}
        dismissedIds={dismissedIds}
        stale={openRequests.stale && blocked}
        onRetry={() => void openRequests.retry()}
      />

      {evidenceMode ? (
        <ObjectiveEvidenceSections
          objective={objective}
          evidence={objectiveEvidence}
          mode={evidenceMode}
          loading={props.evidenceLoading}
          truncation={props.evidenceTruncation}
        />
      ) : hasHistory ? (
        <ObjectiveEvidenceSections
          objective={objective}
          evidence={objectiveEvidence}
          mode="history"
          loading={props.evidenceLoading}
          truncation={props.evidenceTruncation}
        />
      ) : notStarted ? (
        <p className="text-sm text-(--color-ink-dim)">
          Nothing has run yet. Deliveries and file changes appear here once this objective starts.
        </p>
      ) : null}
    </div>
  );
}

function DetailSectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
        className
      )}
    >
      {children}
    </p>
  );
}

function IdentifierButton({
  objective,
  className
}: {
  objective: ObjectiveDto;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1200 });
  const fullId = objective.displayId || objective.id;
  return (
    <button
      type="button"
      aria-label={`Copy ${fullId}`}
      title={`Copy ${fullId}`}
      onClick={() => void copy(fullId)}
      className={cn(
        'inline-flex h-7 min-w-[5rem] items-center justify-center rounded-md px-1.5 font-mono text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
        copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-(--color-ink-dim)',
        className
      )}
    >
      {copied ? 'Copied' : fullId}
    </button>
  );
}

const BADGE_TONE_CLASS = {
  blocked:
    'border-amber-400/60 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  active:
    'border-emerald-400/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  launching: 'border-sky-400/50 bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  done: 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink-dim)',
  neutral: 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink)'
} as const;

function StateBadge({
  label,
  tone,
  state,
  blocked
}: {
  label: string;
  tone: keyof typeof BADGE_TONE_CLASS;
  state: ObjectiveDto['state'];
  blocked: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium',
        BADGE_TONE_CLASS[tone]
      )}
    >
      <ObjectiveStateIcon state={state} blocked={blocked} />
      {label}
    </span>
  );
}

function IconControl({
  label,
  onClick,
  disabled = false,
  className,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40',
        className
      )}
    >
      {children}
    </button>
  );
}
