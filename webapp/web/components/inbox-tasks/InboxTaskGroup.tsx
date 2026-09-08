import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { INBOX_TASK_GROUP_STYLES } from './inbox-task-group-styles.ts';
import type { InboxTaskGroupKey } from './inbox-task-groups.ts';

/**
 * One due-state bucket of the Inbox task list. Deliberately the same header /
 * rail chrome as `MissionListStatusGroup`, so the Inbox reads as a sibling of
 * the mission list rather than a separate product.
 */
export function InboxTaskGroup({
  groupKey,
  count,
  isCollapsed,
  onToggleCollapse,
  onQuickAdd,
  children
}: {
  groupKey: InboxTaskGroupKey;
  count: number;
  isCollapsed: boolean;
  onToggleCollapse: (key: InboxTaskGroupKey) => void;
  /** Present when this bucket can seed the quick-add input with its due date. */
  onQuickAdd?: (key: InboxTaskGroupKey) => void;
  children: ReactNode;
}) {
  const style = INBOX_TASK_GROUP_STYLES[groupKey];
  const Icon = style.icon;

  return (
    <section>
      <div className="group/header flex items-center gap-2 px-1.5 py-1.5">
        <span
          className={cn(
            'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded',
            style.bg,
            style.text
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        <button
          type="button"
          aria-label={isCollapsed ? `Expand ${style.label}` : `Collapse ${style.label}`}
          aria-expanded={!isCollapsed}
          onClick={() => onToggleCollapse(groupKey)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => onToggleCollapse(groupKey)}
          className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wider', style.text)}
        >
          {style.label}
        </button>

        <span className={cn('h-px flex-1 rounded-full', style.rule)} aria-hidden="true" />

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
        {onQuickAdd ? (
          <button
            type="button"
            onClick={() => onQuickAdd(groupKey)}
            aria-label={`Add task to ${style.label}`}
            title={`Add task · ${style.quickAddHint}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {isCollapsed ? null : (
        <div className={cn('ml-3 flex min-h-6 flex-col gap-0.5 border-l pb-1 pl-1.5', style.rail)}>
          {children}
        </div>
      )}
    </section>
  );
}
