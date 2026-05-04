'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

import BlankTicketCard from './BlankTicketCard';
import type { Ticket } from './KanbanCard';
import { formatStatusLabel } from './ticket-view-helpers';
import TicketListCard from './TicketListCard';
import type { TicketListStatus, TicketListStatusStyle } from './TicketListView.types';

const SHOW_MORE_THRESHOLD = 4;
const SCROLL_THRESHOLD = 12;
const EMPTY_FILE_MENTION_PATHS: string[] = [];

type TicketListStatusGroupProps = {
  status: TicketListStatus;
  style: TicketListStatusStyle;
  tickets: Ticket[];
  pathname: string;
  ticketUrlBase?: string;
  showOrganizationName: boolean;
  projectId?: string;
  completeStatusName?: string;
  isExpanded: boolean;
  isCollapsed: boolean;
  isDropTarget: boolean;
  isReorderTarget: boolean;
  activeBlankStatus: string | null;
  onToggleCollapse: (statusName: string) => void;
  onToggleExpand: (statusName: string) => void;
  onSetActiveBlankStatus: (statusName: string | null) => void;
  onTicketDragOverStatus: (e: React.DragEvent, statusName: string) => void;
  onTicketDragLeaveStatus: (e: React.DragEvent<HTMLDivElement>, statusName: string) => void;
  onTicketDropOnStatus: (e: React.DragEvent, statusName: string) => void;
  onStatusDragStart: (e: React.DragEvent, statusName: string) => void;
  onStatusDragEnd: () => void;
  onStatusDragOver: (e: React.DragEvent, statusName: string) => void;
  onStatusDrop: (e: React.DragEvent, statusName: string) => void;
  onClearStatusReorderTarget: () => void;
  onTicketDragStart: (ticketId: string, event: React.DragEvent<HTMLDivElement>) => void;
  onTicketDragEnd: () => void;
  onCompleteTicket?: (ticketId: string) => void;
  onMarkUnread?: (ticketId: string) => void;
  onCreateTicket: (
    status: string,
    objective: string,
    position: 'top' | 'bottom'
  ) => Promise<void> | void;
  onCreateAndOpenTicket: (
    status: string,
    objective: string,
    position: 'top' | 'bottom'
  ) => Promise<void> | void;
};

export function TicketListStatusGroup({
  status,
  style,
  tickets: groupTickets,
  pathname,
  ticketUrlBase,
  showOrganizationName,
  projectId,
  completeStatusName,
  isExpanded,
  isCollapsed,
  isDropTarget,
  isReorderTarget,
  activeBlankStatus,
  onToggleCollapse,
  onToggleExpand,
  onSetActiveBlankStatus,
  onTicketDragOverStatus,
  onTicketDragLeaveStatus,
  onTicketDropOnStatus,
  onStatusDragStart,
  onStatusDragEnd,
  onStatusDragOver,
  onStatusDrop,
  onClearStatusReorderTarget,
  onTicketDragStart,
  onTicketDragEnd,
  onCompleteTicket,
  onMarkUnread,
  onCreateTicket,
  onCreateAndOpenTicket
}: TicketListStatusGroupProps) {
  const StatusIcon = style.icon;
  const hasRunning = groupTickets.some(ticket => ticket.has_executing_objective === true);
  const hasAttention = groupTickets.some(
    ticket => ticket.is_read === false || ticket.has_unopened_waiting_response === true
  );
  const shouldScroll = isExpanded && groupTickets.length >= SCROLL_THRESHOLD;
  const visibleTickets =
    isExpanded || groupTickets.length <= SHOW_MORE_THRESHOLD
      ? groupTickets
      : groupTickets.slice(0, SHOW_MORE_THRESHOLD);
  const hiddenCount = groupTickets.length - SHOW_MORE_THRESHOLD;

  return (
    <div
      className="flex flex-col gap-1"
      onDragOver={e => {
        onTicketDragOverStatus(e, status.name);
        onStatusDragOver(e, status.name);
      }}
      onDragLeave={e => {
        onTicketDragLeaveStatus(e, status.name);
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          if (isReorderTarget) {
            onClearStatusReorderTarget();
          }
        }
      }}
      onDrop={e => {
        onTicketDropOnStatus(e, status.name);
        onStatusDrop(e, status.name);
      }}
    >
      {isReorderTarget ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
          Release to reorder here
        </div>
      ) : null}
      <div
        onDragOver={e => onTicketDragOverStatus(e, status.name)}
        onDragLeave={e => onTicketDragLeaveStatus(e, status.name)}
        onDrop={e => onTicketDropOnStatus(e, status.name)}
        className="group/header flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors"
      >
        <div
          draggable
          onDragStart={e => onStatusDragStart(e, status.name)}
          onDragEnd={onStatusDragEnd}
          className="cursor-grab touch-none opacity-0 transition-opacity group-hover/header:opacity-100 active:cursor-grabbing"
          title="Drag to reorder"
          aria-label={`Reorder ${formatStatusLabel(status.name)}`}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>

        <div
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded',
            style.bg,
            style.text
          )}
        >
          <StatusIcon className="h-3 w-3" />
        </div>
        <button
          type="button"
          onClick={() => onToggleCollapse(status.name)}
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-70',
            style.text
          )}
          title={
            isCollapsed
              ? `Expand ${formatStatusLabel(status.name)}`
              : `Collapse ${formatStatusLabel(status.name)}`
          }
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {formatStatusLabel(status.name)}
        </button>
        {hasRunning ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_4px_rgb(16,185,129)]"
            title="Agent running in this stage"
          />
        ) : null}
        {hasAttention ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
            title="Tickets need attention"
          />
        ) : null}
        <div className={cn('h-px flex-1', style.rule)} />
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {groupTickets.length}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={() => onSetActiveBlankStatus(status.name)}
          aria-label={`Add ticket to ${formatStatusLabel(status.name)}`}
          title={`Add ticket to ${formatStatusLabel(status.name)}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {!isCollapsed ? (
        <div
          onDragOver={e => onTicketDragOverStatus(e, status.name)}
          onDragLeave={e => onTicketDragLeaveStatus(e, status.name)}
          onDrop={e => onTicketDropOnStatus(e, status.name)}
          className={cn('ml-2 border-l pl-2', style.rail, shouldScroll && 'pr-1')}
          style={shouldScroll ? { maxHeight: 320, overflowY: 'auto' } : undefined}
        >
          {activeBlankStatus === status.name ? (
            <div className="mb-1">
              <BlankTicketCard
                inputId={`list-blank-card-${status.name}`}
                status={status.name}
                position="top"
                expand={false}
                closeOnSubmit
                fileMentionPaths={EMPTY_FILE_MENTION_PATHS}
                onCreateTicket={onCreateTicket}
                onCreateAndOpenTicket={onCreateAndOpenTicket}
                onClose={() => onSetActiveBlankStatus(null)}
              />
            </div>
          ) : null}
          {groupTickets.length === 0 && activeBlankStatus !== status.name ? (
            isDropTarget ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                Release to drop here
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground">
                No tickets - drag one here or click + to add
              </div>
            )
          ) : groupTickets.length === 0 ? null : (
            <SortableContext
              items={visibleTickets.map(t => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-0.5">
                {visibleTickets.map(ticket => {
                  const ticketPath = ticketUrlBase
                    ? `${ticketUrlBase}/${ticket.id}`
                    : buildTicketPath({
                        projectId: ticket.project_id,
                        ticketId: ticket.id
                      });
                  const isSelected = pathname === ticketPath;
                  return (
                    <TicketListCard
                      key={ticket.id}
                      ticket={ticket}
                      ticketPath={ticketPath}
                      isSelected={isSelected}
                      showOrganizationName={showOrganizationName}
                      showProjectName={!projectId}
                      completeStatusName={completeStatusName}
                      onCompleteTicket={onCompleteTicket}
                      onMarkUnread={onMarkUnread}
                      onDragStart={onTicketDragStart}
                      onDragEnd={onTicketDragEnd}
                    />
                  );
                })}
                {isDropTarget ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">
                    Release to drop here
                  </div>
                ) : null}
                {!isExpanded && hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(status.name)}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  >
                    <ChevronDown className="h-3 w-3" />
                    {hiddenCount} more
                  </button>
                ) : null}
                {isExpanded && groupTickets.length > SHOW_MORE_THRESHOLD ? (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(status.name)}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  >
                    <ChevronUp className="h-3 w-3" />
                    Show less
                  </button>
                ) : null}
              </div>
            </SortableContext>
          )}
        </div>
      ) : null}
    </div>
  );
}
