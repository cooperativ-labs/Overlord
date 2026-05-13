'use client';

import { ArrowUpCircle, ChevronDown, Loader2 } from 'lucide-react';
import { useMemo, useRef, useState, useTransition } from 'react';

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
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import { promoteFutureObjectiveAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import {
  getAgentTypeByIdentifier,
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import type { AgentCommands } from '@/lib/overlord/launch-commands';
import { cn } from '@/lib/utils';

const promoteFutureObjectiveActionWithRetry = withElectronActionRetry(promoteFutureObjectiveAction);

/** Max height for the draft objective editor; overflow scrolls inside the textarea. */
const DRAFT_OBJECTIVE_EDITOR_MAX_HEIGHT_PX = 450;

type DraftObjectiveProps = {
  ticketId: string;
  organizationId?: number;
  objectiveId: string;
  objectiveState: string | null;
  initialValue: string;
  canMarkExecuted: boolean;
  fileMentionPaths: string[];
  initialAttachments: ObjectiveAttachment[];
  workingDirectory: string | null;
  assignedAgent?: TicketAssignedAgent | null;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  agentCommands?: AgentCommands;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
};

export function DraftObjective({
  ticketId,
  organizationId,
  objectiveId,
  objectiveState,
  initialValue,
  canMarkExecuted,
  fileMentionPaths,
  initialAttachments,
  workingDirectory,
  assignedAgent,
  projectId,
  agentFlags,
  agentCommands,
  sshCommand,
  remoteWorkingDirectory,
  hasProjectWorkingDirectory
}: DraftObjectiveProps) {
  const editFieldRef = useRef<InlineEditFieldHandle>(null);
  const [cliQuickstartOpen, setCliQuickstartOpen] = useState(false);
  const [promoting, startPromoteTransition] = useTransition();
  const { session, events } = useTicketLive();
  const activeAgentType = getAgentTypeByIdentifier(session?.agent_identifier ?? null);
  const showAgentControls = assignedAgent !== undefined;
  const isFuture = objectiveState === 'future';
  const splitButtonCommands = useMemo<Record<LaunchAgentTypeValue, string>>(
    () => ({
      claude: agentCommands?.launchCommands?.claudeCode ?? '',
      codex: agentCommands?.launchCommands?.codex ?? '',
      cursor: agentCommands?.launchCommands?.cursor ?? '',
      gemini: agentCommands?.launchCommands?.gemini ?? '',
      opencode: agentCommands?.launchCommands?.opencode ?? ''
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
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDownload,
    handleDelete,
    dismissUploadingItem
  } = useObjectiveAttachmentState({
    ticketId,
    objectiveId,
    initialAttachments
  });
  const isSubmitted = objectiveState === 'submitted';

  function handlePromoteFuture() {
    startPromoteTransition(async () => {
      await promoteFutureObjectiveActionWithRetry({ ticketId, objectiveId });
    });
  }

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-border/60 transition-all focus-within:ring-1 focus-within:ring-ring/40',
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
      <InlineEditField
        ref={editFieldRef}
        alwaysEditing
        autoListContinuation="enter"
        displayClassName="text-base leading-relaxed"
        field="objective"
        fileMentionPaths={fileMentionPaths}
        initialValue={initialValue}
        inputClassName="text-base leading-relaxed"
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
          objectiveId={objectiveId}
          attachmentsCount={attachments.length}
          hasItems={hasItems}
          isDragOver={isDragOver}
          inputRef={inputRef}
          onInputChange={handleInputChange}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
                CLI
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
          />
          {showAgentControls ? (
            <>
              <div className="mx-1 h-4 w-px bg-border/50" />
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
                    assignedAgent ? getLaunchAgentTypeByIdentifier(assignedAgent.agent) : undefined
                  }
                  ticketId={ticketId}
                  organizationId={organizationId}
                  projectId={projectId ?? null}
                  agentFlags={agentFlags}
                  commands={splitButtonCommands}
                  workingDirectory={workingDirectory}
                  sshCommand={sshCommand ?? null}
                  remoteWorkingDirectory={remoteWorkingDirectory ?? null}
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
            className="border-t border-border/40 bg-muted/10 px-2 py-2"
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
  );
}
