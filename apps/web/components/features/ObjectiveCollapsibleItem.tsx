'use client';

import { CheckCircle, ChevronDown, Loader2 } from 'lucide-react';
import Image from 'next/image';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import {
  ObjectiveAttachmentList,
  useObjectiveAttachmentState
} from '@/components/features/ObjectiveAttachmentUpload';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
};

export function ObjectiveCollapsibleItem({
  objective,
  index,
  ticketId,
  attachments,
  checkpoint
}: ObjectiveCollapsibleItemProps) {
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

  return (
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
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/60 select-all">
              {checkpoint.git_ref_name}
            </p>
          ) : null}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
