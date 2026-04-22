'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import Image from 'next/image';
import { useTransition } from 'react';

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu';
import { updateTicketPriorityAction } from '@/lib/actions/tickets';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

import type { Ticket } from './KanbanCard';

/* ------------------------------------------------------------------ */
/*  StatusDot                                                          */
/* ------------------------------------------------------------------ */

export function StatusDot({
  colorClassName,
  label,
  title
}: {
  colorClassName: string;
  label: string;
  title: string;
}) {
  return (
    <span
      className={cn('h-2.5 w-2.5 rounded-full ring-2 ring-background', colorClassName)}
      aria-label={label}
      title={title}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  AttentionIndicators (waiting + unread dots)                        */
/* ------------------------------------------------------------------ */

export function AttentionIndicators({
  hasUnopenedWaitingResponse,
  hasUnopenedReview,
  className
}: {
  hasUnopenedWaitingResponse: boolean;
  hasUnopenedReview: boolean;
  className?: string;
}) {
  if (!hasUnopenedWaitingResponse && !hasUnopenedReview) return null;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {hasUnopenedWaitingResponse ? (
        <StatusDot
          colorClassName="bg-red-500"
          label="Agent waiting for response"
          title="Agent is waiting for your response"
        />
      ) : null}
      {hasUnopenedReview ? (
        <StatusDot
          colorClassName="bg-sky-500"
          label="Moved to review and unopened"
          title="This ticket moved to review and has not been opened yet"
        />
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  ActiveAgentDisplay                                                 */
/* ------------------------------------------------------------------ */

export function ActiveAgentDisplay({ identifier }: { identifier: string | null }) {
  if (!identifier) return null;
  const agentType = getAgentTypeByIdentifier(identifier);
  return (
    <div className="min-w-0">
      {agentType ? (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <Image
            src={agentType.icon}
            alt={`${agentType.label} icon`}
            width={12}
            height={12}
            className={cn('h-3 w-3 shrink-0', agentType.invertDark ? 'dark:invert' : '')}
          />
          <span className="truncate">{agentType.label}</span>
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground/70 truncate">{identifier}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ProjectColorDot                                                    */
/* ------------------------------------------------------------------ */

export function ProjectColorDot({
  color,
  name,
  size = 'md'
}: {
  color: string | null | undefined;
  name: string | null | undefined;
  size?: 'sm' | 'md';
}) {
  const sizeClass = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  if (color) {
    return (
      <span
        className={cn('block shrink-0 rounded-[2px] border', sizeClass)}
        style={{ backgroundColor: color, borderColor: color }}
        title={name ?? 'Project'}
      />
    );
  }

  return (
    <span
      className={cn('block shrink-0 rounded-[2px] border border-muted-foreground/50', sizeClass)}
      title={name ?? 'Personal ticket'}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  ObjectivesExecutedBadge                                            */
/* ------------------------------------------------------------------ */

export function ObjectivesExecutedBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-muted-foreground/30 bg-muted px-1 text-[10px] font-medium text-muted-foreground"
      title={`${count} objective${count === 1 ? '' : 's'} executed`}
      aria-label={`${count} objective${count === 1 ? '' : 's'} executed`}
    >
      {count}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  TicketPriorityContextMenu                                          */
/* ------------------------------------------------------------------ */

export function TicketPriorityContextMenu({
  ticketId,
  priority,
  extraItems
}: {
  ticketId: string;
  priority: string;
  extraItems?: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const isHighPriority = priority === 'high';
  const isMediumPriority = priority === 'medium';
  const raiseDisabled = isPending || !isMediumPriority;
  const reduceDisabled = isPending || !isHighPriority;

  function handlePriorityChange(nextPriority: Database['public']['Enums']['ticket_priority']) {
    startTransition(async () => {
      await updateTicketPriorityAction(ticketId, nextPriority);
    });
  }

  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => handlePriorityChange('high')} disabled={raiseDisabled}>
        <ArrowUp className="h-3.5 w-3.5" />
        Raise priority
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => handlePriorityChange('medium')} disabled={reduceDisabled}>
        <ArrowDown className="h-3.5 w-3.5" />
        Reduce priority
      </ContextMenuItem>
      {extraItems ? (
        <>
          <ContextMenuSeparator />
          {extraItems}
        </>
      ) : null}
    </ContextMenuContent>
  );
}
