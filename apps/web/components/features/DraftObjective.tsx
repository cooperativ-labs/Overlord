'use client';

import {
  ArrowUpCircle,
  ChevronDown,
  ChevronUp,
  FastForward,
  Loader2,
  PauseCircle,
  SquareTerminal,
  Upload
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { AgentModelChooserButton } from '@/components/features/AgentModelChooserButton';
import { CliQuickstart } from '@/components/features/CliQuickstart';
import { InlineEditField, type InlineEditFieldHandle } from '@/components/features/InlineEditField';
import {
  ObjectiveAttachmentList,
  ObjectiveAttachmentUploadTrigger,
  useObjectiveAttachmentState
} from '@/components/features/ObjectiveAttachmentUpload';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { AgentSplitButtonLive, useTicketLive } from '@/components/features/TicketLiveProvider';
import { Button } from '@/components/ui/button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import { promoteFutureObjectiveAction, setObjectiveAutoAdvanceAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import {
  getAgentTypeByIdentifier,
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import type { AgentCommands } from '@/lib/overlord/launch-commands';
import { cn } from '@/lib/utils';
import type { TicketAssignedAgent } from '@/types/tickets';

const promoteFutureObjectiveActionWithRetry = withElectronActionRetry(promoteFutureObjectiveAction);

/** Max height for the draft objective editor; overflow scrolls inside the textarea. */
const DRAFT_OBJECTIVE_EDITOR_MAX_HEIGHT_PX = 450;

type DraftObjectiveProps = {
  ticketId: string;
  organizationId?: number;
  objectiveId: string;
  objectiveState: string | null;
  initialAutoAdvance?: boolean;
  initialValue: string;
  canMarkExecuted: boolean;
  fileMentionPaths: string[];
  initialAttachments: ObjectiveAttachment[];
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

export function DraftObjective({
  ticketId,
  organizationId,
  objectiveId,
  objectiveState,
  initialAutoAdvance = false,
  initialValue,
  canMarkExecuted,
  fileMentionPaths,
  initialAttachments,
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
}: DraftObjectiveProps) {
  const editFieldRef = useRef<InlineEditFieldHandle>(null);
  const [cliQuickstartOpen, setCliQuickstartOpen] = useState(false);
  const [promoting, startPromoteTransition] = useTransition();
  const { session, events } = useTicketLive();
  const activeAgentType = getAgentTypeByIdentifier(session?.agent_identifier ?? null);
  const showAgentControls = assignedAgent !== undefined;
  const isFuture = objectiveState === 'future';
  const canToggleAutoAdvance =
    objectiveState === 'draft' || objectiveState === 'submitted' || objectiveState === 'future';
  const [autoAdvanceValue, setAutoAdvanceValue] = useState(initialAutoAdvance);
  const splitButtonCommands = useMemo<Record<LaunchAgentType, string>>(
    () => ({
      claude: agentCommands?.launchCommands?.claudeCode ?? '',
      codex: agentCommands?.launchCommands?.codex ?? '',
      cursor: agentCommands?.launchCommands?.cursor ?? '',
      antigravity: agentCommands?.launchCommands?.antigravity ?? '',
      opencode: agentCommands?.launchCommands?.opencode ?? '',
      pi: agentCommands?.launchCommands?.pi ?? ''
    }),
    [agentCommands]
  );
  const {
    attachments,
    uploading,
    deletingIds,
    hasItems,
    isDragOver,
    inputRef,
    handleInputChange,
    onDropFiles,
    dropZoneProps,
    handleDownload,
    handleDelete,
    dismissUploadingItem
  } = useObjectiveAttachmentState({
    ticketId,
    objectiveId,
    initialAttachments
  });
  const isSubmitted = objectiveState === 'submitted';
  const [isAutoAdvancePending, setIsAutoAdvancePending] = useState(false);
  const [isFutureExpanded, setIsFutureExpanded] = useState(false);

  useEffect(() => {
    setAutoAdvanceValue(initialAutoAdvance);
  }, [initialAutoAdvance]);

  function handlePromoteFuture() {
    startPromoteTransition(async () => {
      await promoteFutureObjectiveActionWithRetry({ ticketId, objectiveId });
    });
  }

  async function handleAutoAdvanceToggle(nextValue: boolean) {
    if (!canToggleAutoAdvance || isAutoAdvancePending) return;
    setIsAutoAdvancePending(true);
    try {
      await setObjectiveAutoAdvanceAction({
        ticketId,
        objectiveId,
        autoAdvance: nextValue
      });
      setAutoAdvanceValue(nextValue);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update auto-advance.');
    } finally {
      setIsAutoAdvancePending(false);
    }
  }

  function handleCollapseFutureObjective() {
    setIsFutureExpanded(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  return (
    <FileDropZone
      onDrop={onDropFiles}
      disabled={!objectiveId}
      dragState={{ isDragOver, rootProps: dropZoneProps }}
      overlay={
        <div
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-emerald-500/15 backdrop-blur-xs ring-2 ring-inset ring-emerald-500/35"
          aria-hidden
        >
          <Upload className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Drop to upload
          </span>
        </div>
      }
      className={cn(
        'w-full overflow-hidden border rounded-xl transition-all focus-within:ring-1 focus-within:ring-ring/50 min-w-[350px]',
        isFuture
          ? 'border-border-500/35 bg-muted/20 opacity-70 focus-within:opacity-100 focus-within:ring-ring/55'
          : 'border-muted-foreground/20',
        isSubmitted && 'border-sky-400/45 bg-sky-500/3 focus-within:ring-sky-400/30'
      )}
    >
      {isSubmitted ? (
        <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_6s_linear_infinite] bg-linear-to-r from-transparent via-sky-400/10 to-transparent" />
      ) : null}
      {/* {workingDirectory ? (
        <div className="px-3 pt-3 pb-1">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            onClick={() => editFieldRef.current?.triggerAtMention()}
          >
            <AtSign className="h-3.5 w-3.5" />
            Add context
          </button>
        </div>
      ) : null} */}
      <div
        onFocusCapture={() => {
          if (isFuture) {
            setIsFutureExpanded(true);
          }
        }}
      >
        <div
          className={cn(
            'relative transition-[max-height] duration-200 ease-in-out',
            isFuture && !isFutureExpanded && 'max-h-[3.25rem] overflow-hidden',
            isFuture && isFutureExpanded && 'max-h-[500px] overflow-hidden'
          )}
        >
          <InlineEditField
            ref={editFieldRef}
            alwaysEditing
            autoFocus={!isFuture}
            autoListContinuation="enter"
            displayClassName="text-base leading-relaxed"
            field="objective"
            fileMentionPaths={fileMentionPaths}
            initialValue={initialValue}
            inputClassName={cn(
              'text-base leading-relaxed',
              isFuture ? 'text-muted-foreground' : ''
            )}
            multiline
            objectiveRowId={objectiveId || undefined}
            objectiveState={objectiveState}
            placeholder="Click to add an objective…"
            renderMarkdown
            seamless
            textareaMaxHeightPx={DRAFT_OBJECTIVE_EDITOR_MAX_HEIGHT_PX}
            ticketId={ticketId}
            variant="textarea"
            workingDirectory={workingDirectory}
          />
          {isFuture && isFutureExpanded ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 h-6 w-6 rounded-full border border-border/50 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
              aria-label="Collapse objective"
              onClick={handleCollapseFutureObjective}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {isFuture && !isFutureExpanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background/80 to-transparent" />
          ) : null}
        </div>
        <div className="border-t border-border/40">
          <ObjectiveAttachmentList
            attachments={attachments}
            uploading={uploading}
            deletingIds={deletingIds}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onDismissUploadingItem={dismissUploadingItem}
            toolbar
          />
          <ObjectiveAttachmentUploadTrigger
            toolbar
            omitDropZone
            objectiveId={objectiveId}
            attachmentsCount={attachments.length}
            hasItems={hasItems}
            isDragOver={isDragOver}
            inputRef={inputRef}
            onInputChange={handleInputChange}
            leadingToolbarExtras={
              isFuture ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-0.5 px-2 text-xs text-muted-foreground"
                  aria-expanded={cliQuickstartOpen}
                  aria-controls="draft-objective-cli-quickstart"
                  onClick={() => setCliQuickstartOpen(open => !open)}
                >
                  <SquareTerminal size={16} />
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                      cliQuickstartOpen && 'rotate-180'
                    )}
                    aria-hidden
                  />
                </Button>
              )
            }
          >
            <ObjectiveMenuButton
              canMarkExecuted={canMarkExecuted}
              objectiveId={objectiveId}
              state={objectiveState}
              ticketId={ticketId}
              agentIdentifier={
                session?.objective_id === objectiveId
                  ? session.agent_identifier
                  : (activeAgentType?.value ?? null)
              }
              externalSessionId={
                session?.objective_id === objectiveId ? session.external_session_id : null
              }
            />
            {canToggleAutoAdvance ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 gap-1 px-2 text-xs',
                      autoAdvanceValue ? 'text-emerald-600' : 'text-amber-600'
                    )}
                    disabled={isAutoAdvancePending}
                    aria-label={autoAdvanceValue ? 'Auto-advance on' : 'Auto-advance off'}
                    title={autoAdvanceValue ? 'Auto-advance ON' : 'Auto-advance OFF'}
                  >
                    {isAutoAdvancePending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : autoAdvanceValue ? (
                      <FastForward className="h-3.5 w-3.5" />
                    ) : (
                      <PauseCircle className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">Auto-advance</span>
                      <Switch
                        checked={autoAdvanceValue}
                        disabled={isAutoAdvancePending}
                        onCheckedChange={handleAutoAdvanceToggle}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When enabled, this objective will automatically start executing after the
                      previous one completes. When disabled, it will wait for manual approval before
                      starting.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
            {showAgentControls ? (
              <>
                <AgentModelChooserButton
                  ticketId={ticketId}
                  objectiveId={objectiveId}
                  initialSelection={assignedAgent ?? null}
                  persistSelection
                />
                {isFuture ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={promoting}
                    onClick={handlePromoteFuture}
                  >
                    {promoting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowUpCircle className="h-3.5 w-3.5" />
                    )}
                    Promote
                  </Button>
                ) : (
                  <AgentSplitButtonLive
                    assignedSelection={assignedAgent ?? null}
                    defaultAgent={
                      assignedAgent
                        ? getLaunchAgentTypeByIdentifier(assignedAgent.agent)
                        : undefined
                    }
                    ticketId={ticketId}
                    organizationId={organizationId}
                    projectId={projectId ?? null}
                    agentFlags={agentFlags}
                    agentPreCommands={agentPreCommands}
                    commands={splitButtonCommands}
                    workingDirectory={workingDirectory}
                    sshCommand={sshCommand ?? null}
                    remoteWorkingDirectory={remoteWorkingDirectory ?? null}
                    sshEnabled={sshEnabled}
                    hasProjectWorkingDirectory={hasProjectWorkingDirectory ?? false}
                    submitObjectiveId={objectiveId}
                    size="sm"
                  />
                )}
              </>
            ) : null}
          </ObjectiveAttachmentUploadTrigger>
          {cliQuickstartOpen && !isFuture ? (
            <div
              id="draft-objective-cli-quickstart"
              className="border-t border-border/40 bg-muted/10 p-4"
            >
              <CliQuickstart
                variant="embedded"
                activeAgentValue={activeAgentType?.value}
                externalSessionId={session?.external_session_id ?? null}
                hasExecutedObjectives={events.length > 0}
                agentCommands={agentCommands}
              />
            </div>
          ) : null}
        </div>
      </div>
    </FileDropZone>
  );
}
