'use client';

import { useRef } from 'react';

import { AgentModelChooserButton } from '@/components/features/AgentModelChooserButton';
import { InlineEditField, type InlineEditFieldHandle } from '@/components/features/InlineEditField';
import {
  ObjectiveAttachmentList,
  ObjectiveAttachmentUploadTrigger,
  useObjectiveAttachmentState
} from '@/components/features/ObjectiveAttachmentUpload';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { AgentSplitButtonLive } from '@/components/features/TicketLiveProvider';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import {
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { cn } from '@/lib/utils';

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
  agentCommands?: Record<LaunchAgentTypeValue, string>;
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
  const showAgentControls = assignedAgent !== undefined;
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
        inputClassName="text-base leading-relaxed max-h-[450px] overflow-y-auto"
        multiline
        placeholder="Click to add an objective…"
        renderMarkdown
        seamless
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
              <AgentSplitButtonLive
                assignedSelection={assignedAgent ?? null}
                defaultAgent={
                  assignedAgent ? getLaunchAgentTypeByIdentifier(assignedAgent.agent) : undefined
                }
                ticketId={ticketId}
                organizationId={organizationId}
                projectId={projectId ?? null}
                agentFlags={agentFlags}
                commands={
                  agentCommands ?? {
                    claude: '',
                    codex: '',
                    cursor: '',
                    gemini: '',
                    opencode: ''
                  }
                }
                workingDirectory={workingDirectory}
                sshCommand={sshCommand ?? null}
                remoteWorkingDirectory={remoteWorkingDirectory ?? null}
                hasProjectWorkingDirectory={hasProjectWorkingDirectory ?? false}
                size="sm"
              />
            </>
          ) : null}
        </ObjectiveAttachmentUploadTrigger>
      </div>
    </div>
  );
}
