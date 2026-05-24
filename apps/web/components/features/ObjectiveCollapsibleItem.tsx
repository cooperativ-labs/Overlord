'use client';

import { AlertTriangle, CheckCircle, ChevronDown, FastForward, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useState, useTransition } from 'react';

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
import { updateObjectiveTitleAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';
import type { ObjectiveRow } from '@/types/objectives';

const updateObjectiveTitleActionWithRetry = withElectronActionRetry(updateObjectiveTitleAction);

type ObjectiveCollapsibleItemProps = {
  objective: ObjectiveRow;
  index: number;
  ticketId: string;
  attachments: ObjectiveAttachment[];
  workingDirectory: string | null;
  resumeAgentIdentifier?: string | null;
  externalSessionId?: string | null;
};

export function ObjectiveCollapsibleItem({
  objective,
  index,
  ticketId,
  attachments,
  workingDirectory,
  resumeAgentIdentifier = null,
  externalSessionId = null
}: ObjectiveCollapsibleItemProps) {
  const [editTitleOpen, setEditTitleOpen] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(objective.title ?? '');
  const [titleUpdateState, setTitleUpdateState] = useState<ButtonLoadingState>('default');
  const [titlePending, startTitleTransition] = useTransition();
  const objectiveTimestamp = new Date(objective.created_at).toLocaleString();
  const isExecuting = objective.state === 'executing';
  const isPendingDelivery = objective.state === 'pending_delivery';
  const agentType = getAgentTypeByIdentifier(objective.agent_identifier);
  const modelIdentifier = objective.model_identifier?.trim() || null;
  const timestampLabel = isExecuting
    ? 'Executing since'
    : isPendingDelivery
      ? 'Pending delivery since'
      : 'Completed';
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

  async function handleUpdateTitle() {
    setTitleUpdateState('loading');
    try {
      await updateObjectiveTitleActionWithRetry({
        ticketId,
        objectiveId: objective.id,
        title: editTitleValue
      });
      setTitleUpdateState('success');
      setTimeout(() => setEditTitleOpen(false), 300);
    } catch (error) {
      setTitleUpdateState('error');
    }
  }

  return (
    <>
      <Collapsible defaultOpen={false}>
        <div className="relative rounded-md overflow-hidden">
          {(isExecuting || isPendingDelivery) && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent " />
          )}
          <div className={' flex items-center overflow-hidden rounded-md pr-1 hover:bg-background'}>
            <CollapsibleTrigger asChild>
              <button
                className={cn(
                  'relative flex flex-1 flex-col rounded-md pl-3 pr-1 py-2 text-left overflow-hidden min-w-0',
                  !isExecuting && !isPendingDelivery && 'hover:bg-background'
                )}
                type="button"
              >
                <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {objective.state === 'executing' ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : objective.state === 'pending_delivery' ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
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
                              className={cn(
                                'h-3.5 w-3.5',
                                agentType.invertDark ? 'dark:invert' : ''
                              )}
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
                </div>
                {objective.auto_advanced_at ? (
                  <div className="mt-0.5 flex items-center gap-1 pl-[18px] text-[11px] text-muted-foreground">
                    <FastForward className="h-3 w-3" />
                    <span>Auto-advanced</span>
                  </div>
                ) : null}
              </button>
            </CollapsibleTrigger>
            <ObjectiveMenuButton
              ticketId={ticketId}
              objectiveId={objective.id}
              state={objective.state}
              canMarkExecuted={objective.objective.trim().length > 0}
              agentIdentifier={resumeAgentIdentifier ?? objective.agent_identifier}
              externalSessionId={externalSessionId}
              onEditTitle={() => setEditTitleOpen(true)}
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
          </CollapsibleContent>
        </div>
      </Collapsible>
      <Dialog open={editTitleOpen} onOpenChange={setEditTitleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Objective Title</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type="text"
              value={editTitleValue}
              onChange={e => setEditTitleValue(e.target.value)}
              placeholder="Enter objective title"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              disabled={titlePending}
              onKeyDown={e => {
                if (e.key === 'Enter' && !titlePending) {
                  void handleUpdateTitle();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditTitleOpen(false)}
              disabled={titlePending}
            >
              Cancel
            </Button>
            <LoadingButton
              buttonState={titleUpdateState}
              setButtonState={setTitleUpdateState}
              text="Save"
              loadingText="Saving..."
              successText="Saved"
              errorText="Failed to save"
              disabled={titlePending || !editTitleValue.trim()}
              onClick={() => void handleUpdateTitle()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
