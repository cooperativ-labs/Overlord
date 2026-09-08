import { ChevronDown, ChevronRight, Trash2, Undo2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { InboxMissionCard } from '@/components/InboxMissionCard.tsx';
import { DueDatePickerButton } from '@/components/scheduling/DueDatePickerButton.tsx';
import { usePromoteInboxItem, useUpdateInboxItem } from '@/lib/queries.ts';
import { cn } from '@/lib/utils';

import type { InboxItemDto, MissionDetailDto } from '../../../shared/contract.ts';
import { MissionCompleteCheckbox } from '../../pages/MissionCardPrimitives.tsx';

import { InboxProjectAssignMenu } from './InboxProjectAssignMenu.tsx';

/**
 * A private Inbox capture drawn as a task-list row: checkbox, title, then an
 * editable due-date pill, a quick project assign, and delete. Clicking the
 * row expands the full capture editor beneath it — the same card the Inbox
 * used before — so agent, resource, and Run remain one click away without
 * every row paying for that chrome.
 */
export function InboxTaskRow({
  item,
  isExpanded,
  onToggleExpanded,
  isCompleting,
  onComplete,
  onUndoComplete,
  onDelete,
  onPromoted
}: {
  item: InboxItemDto;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** Checked and counting down to removal; the row shows Undo instead of actions. */
  isCompleting: boolean;
  onComplete: () => void;
  onUndoComplete: () => void;
  onDelete: () => void;
  onPromoted: (mission: MissionDetailDto) => void;
}) {
  const updateInbox = useUpdateInboxItem();
  const promote = usePromoteInboxItem();
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const body = item.objectives[0] ?? '';
  const title = item.title.trim() || body.split('\n')[0]?.trim() || 'Untitled task';
  // Anything past the first line is detail; the collapsed row previews it faintly.
  const detail = body.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();

  async function assignProject(projectId: string) {
    if (promote.isPending) return;
    setPromoteError(null);
    try {
      const mission = await promote.mutateAsync({ id: item.id, projectId });
      onPromoted(mission);
    } catch (error) {
      setPromoteError(error instanceof Error ? error.message : 'Failed to assign project.');
    }
  }

  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`${isExpanded ? 'Collapse' : 'Open'} task: ${title}`}
      onClick={onToggleExpanded}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggleExpanded();
        }
      }}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isExpanded && 'bg-muted/30',
        isCompleting && 'opacity-70'
      )}
    >
      <MissionCompleteCheckbox
        color={null}
        completed={isCompleting}
        onComplete={isCompleting ? undefined : onComplete}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm font-semibold leading-snug text-foreground',
              isCompleting && 'text-muted-foreground line-through'
            )}
          >
            {title}
          </span>
          {detail && !isExpanded ? (
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
              {detail}
            </span>
          ) : null}
        </div>
        {promoteError ? <p className="mt-0.5 text-xs text-red-400">{promoteError}</p> : null}
      </div>

      {/* Popover / menu content is portaled but still bubbles through the React
          tree, so this wrapper keeps picker clicks from toggling the row. */}
      <div
        className="flex shrink-0 items-center gap-2"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
      >
        {isCompleting ? (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onUndoComplete();
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-input px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </button>
        ) : (
          <>
            <InboxProjectAssignMenu
              compact
              pending={promote.isPending}
              disabled={promote.isPending}
              onSelect={projectId => void assignProject(projectId)}
            />
            <DueDatePickerButton
              size="badge"
              emptyLabel="Set due date"
              heading="Due date"
              description="Schedule when this task is due."
              value={item.dueDatetime}
              onChange={async next => {
                await updateInbox.mutateAsync({ id: item.id, body: { dueDatetime: next } });
              }}
              disabled={promote.isPending}
            />
            <button
              type="button"
              aria-label="Delete task"
              title="Delete"
              onClick={event => {
                event.stopPropagation();
                onDelete();
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50">
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <InboxRowFrame
      expanded={
        isExpanded ? (
          <InboxMissionCard
            variant="inbox"
            item={item}
            onPromoted={onPromoted}
            onSaved={onToggleExpanded}
          />
        ) : null
      }
    >
      {row}
    </InboxRowFrame>
  );
}

/** Row plus its optional expanded editor, indented to sit under the title. */
export function InboxRowFrame({
  children,
  expanded
}: {
  children: ReactNode;
  expanded: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {children}
      {expanded ? <div className="mb-2 ml-8 mr-2 mt-1">{expanded}</div> : null}
    </div>
  );
}
