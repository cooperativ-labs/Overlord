'use client';

import { CheckCircle, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import {
  ObjectiveAttachmentList,
  useObjectiveAttachmentState
} from '@/components/features/ObjectiveAttachmentUpload';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'created_at' | 'title' | 'state' | 'agent_identifier' | 'model_identifier'
>;

type ObjectiveCheckpoint = {
  git_ref_name: string | null;
  git_commit_id: string | null;
  checkpoint_kind: string;
};

type ObjectiveCollapsibleItemProps = {
  objective: ObjectiveRow;
  index: number;
  ticketId: string;
  attachments: ObjectiveAttachment[];
  checkpoint?: ObjectiveCheckpoint | null;
  gitRevertFeatureEnabled?: boolean;
  workingDirectory: string | null;
};

export function ObjectiveCollapsibleItem({
  objective,
  index,
  ticketId,
  attachments,
  checkpoint,
  gitRevertFeatureEnabled = false,
  workingDirectory
}: ObjectiveCollapsibleItemProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDiff, setPreviewDiff] = useState<string>('');
  const [restoreState, setRestoreState] = useState<ButtonLoadingState>('default');
  const objectiveTimestamp = new Date(objective.created_at).toLocaleString();
  const isExecuting = objective.state === 'executing';
  const agentType = getAgentTypeByIdentifier(objective.agent_identifier);
  const modelIdentifier = objective.model_identifier?.trim() || null;
  const timestampLabel = isExecuting ? 'Executing since' : 'Completed';
  const {
    attachments: objectiveAttachments,
    uploading,
    deletingIds,
    handleDownload,
    handleDelete,
    dismissUploadingItem
  } = useObjectiveAttachmentState({
    ticketId,
    objectiveId: objective.id,
    initialAttachments: attachments
  });

  const canRestoreCheckpoint =
    gitRevertFeatureEnabled && Boolean(checkpoint?.git_commit_id || checkpoint?.git_ref_name);

  async function handleOpenRestorePreview() {
    if (!workingDirectory) {
      alert('No working directory is configured for this project.');
      return;
    }
    const diffCheckpoint = window.electronAPI?.filesystem?.diffCheckpoint;
    if (!diffCheckpoint) {
      alert('Reverting checkpoints is only available in the Overlord desktop app.');
      return;
    }

    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewDiff('');
    setRestoreState('default');
    try {
      const result = await diffCheckpoint({
        directory: workingDirectory,
        objectiveId: objective.id,
        gitCommitId: checkpoint?.git_commit_id ?? undefined
      });
      if (!result.ok) {
        setPreviewError(result.error ?? 'Failed to load checkpoint diff.');
        return;
      }
      setPreviewDiff(result.diff || 'No diff between the checkpoint commit and HEAD.');
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to load checkpoint diff.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestoreCheckpoint() {
    if (!workingDirectory) return;
    const restoreCheckpoint = window.electronAPI?.filesystem?.restoreCheckpoint;
    if (!restoreCheckpoint) {
      setRestoreState('error');
      setPreviewError('Reverting checkpoints is only available in the Overlord desktop app.');
      return;
    }

    setRestoreState('loading');
    try {
      const result = await restoreCheckpoint({
        directory: workingDirectory,
        objectiveId: objective.id
      });
      if (!result.ok) {
        setRestoreState('error');
        setPreviewError(result.error ?? 'Failed to restore checkpoint.');
        return;
      }
      setRestoreState('success');
      setPreviewOpen(false);
    } catch (error) {
      setRestoreState('error');
      setPreviewError(error instanceof Error ? error.message : 'Failed to restore checkpoint.');
    }
  }

  return (
    <>
      <Collapsible defaultOpen={false}>
        <div className="relative rounded-md overflow-hidden">
          {isExecuting && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent " />
          )}
          <div className={' flex items-center overflow-hidden rounded-md pr-1 hover:bg-background'}>
            <CollapsibleTrigger asChild>
              <button
                className={cn(
                  'relative flex flex-1 items-center justify-between rounded-md pl-3 pr-1 py-2 text-left overflow-hidden min-w-0',
                  !isExecuting && 'hover:bg-background'
                )}
                type="button"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {objective.state === 'executing' ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : objective.state === 'complete' ? (
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                  ) : null}
                  {agentType ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex shrink-0 items-center">
                          <Image
                            src={agentType.icon}
                            alt={`${agentType.label} icon`}
                            width={14}
                            height={14}
                            className={cn('h-3.5 w-3.5', agentType.invertDark ? 'dark:invert' : '')}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {modelIdentifier ?? 'Model unavailable'}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-sm font-medium truncate">
                        {objective.title ?? `Objective ${index + 1}`}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {timestampLabel} {objectiveTimestamp}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
              </button>
            </CollapsibleTrigger>
            <ObjectiveMenuButton
              ticketId={ticketId}
              objectiveId={objective.id}
              state={objective.state}
              canMarkExecuted={objective.objective.trim().length > 0}
            />
          </div>
          <CollapsibleContent className="px-3 pb-2 pt-1 border-b">
            <MarkdownContent compact>{objective.objective}</MarkdownContent>
            <ObjectiveAttachmentList
              attachments={objectiveAttachments}
              uploading={uploading}
              deletingIds={deletingIds}
              onDownload={handleDownload}
              onDelete={handleDelete}
              onDismissUploadingItem={dismissUploadingItem}
            />
            {checkpoint?.git_ref_name ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 font-mono text-[10px] text-muted-foreground/60 select-all">
                  {checkpoint.git_ref_name}
                </p>
                {canRestoreCheckpoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={handleOpenRestorePreview}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Revert
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CollapsibleContent>
        </div>
      </Collapsible>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[82vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader>
            <DialogTitle>Revert Objective Checkpoint</DialogTitle>
            <DialogDescription>
              Review the diff from this checkpoint to HEAD before restoring the working tree.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-md border bg-muted/30">
            {previewLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading diff...
              </div>
            ) : (
              <pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-5">
                {previewError ?? previewDiff}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
              Cancel
            </Button>
            <LoadingButton
              buttonState={restoreState}
              setButtonState={setRestoreState}
              text="Restore checkpoint"
              loadingText="Restoring..."
              successText="Restored"
              errorText="Restore failed"
              variant="destructive"
              disabled={previewLoading || Boolean(previewError)}
              onClick={handleRestoreCheckpoint}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
