import {
  AlertCircle,
  CalendarDays,
  Circle,
  type LucideIcon,
  Sparkles,
  Sun,
  Sunrise
} from 'lucide-react';

import type { InboxTaskGroupKey } from './inbox-task-groups.ts';

/**
 * Presentation for each due-state bucket, shaped like `StatusStyle` so the
 * Inbox task list draws the same header / rail / rule chrome as the mission
 * list view (`MissionListStatusGroup`).
 */
export type InboxTaskGroupStyle = {
  label: string;
  icon: LucideIcon;
  text: string;
  bg: string;
  rail: string;
  rule: string;
  /** Day offset used when the header "+" pre-fills a due date; `null` leaves it unset. */
  quickAddDayOffset: number | null;
  /** Hint under the quick-add input when this bucket's "+" opened it. */
  quickAddHint: string;
};

export const INBOX_TASK_GROUP_STYLES: Record<InboxTaskGroupKey, InboxTaskGroupStyle> = {
  overdue: {
    label: 'Overdue',
    icon: AlertCircle,
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/15',
    rail: 'border-l-red-500/40',
    rule: 'bg-red-500/25',
    quickAddDayOffset: null,
    quickAddHint: 'New tasks are never overdue — pick a date after adding.'
  },
  today: {
    label: 'Today',
    icon: Sun,
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/15',
    rail: 'border-l-amber-500/40',
    rule: 'bg-amber-500/25',
    quickAddDayOffset: 0,
    quickAddHint: 'Due today'
  },
  tomorrow: {
    label: 'Tomorrow',
    icon: Sunrise,
    text: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/15',
    rail: 'border-l-blue-500/40',
    rule: 'bg-blue-500/25',
    quickAddDayOffset: 1,
    quickAddHint: 'Due tomorrow'
  },
  later: {
    label: 'Later',
    icon: CalendarDays,
    text: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-500/15',
    rail: 'border-l-violet-500/40',
    rule: 'bg-violet-500/25',
    quickAddDayOffset: 7,
    quickAddHint: 'Due in a week — adjust the date if you like.'
  },
  no_date: {
    label: 'No due date',
    icon: Circle,
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    rail: 'border-l-border',
    rule: 'bg-border',
    quickAddDayOffset: null,
    quickAddHint: 'No due date'
  },
  agent_next: {
    label: 'Agent Next',
    icon: Sparkles,
    text: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500/15',
    rail: 'border-l-indigo-500/40',
    rule: 'bg-indigo-500/25',
    quickAddDayOffset: null,
    quickAddHint: 'No due date'
  }
};
