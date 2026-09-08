import type { InboxItemDto, InboxMissionDto } from '../../../shared/contract.ts';

/**
 * The Inbox task list flattens two sources into one list of rows: private
 * `inbox_items` captures and cross-workspace triage missions from
 * `GET /api/inbox/missions`. Rows are bucketed by when they are due so the
 * page reads like a task list rather than a pile of cards.
 */
export type InboxTaskRow =
  | { kind: 'task'; id: string; item: InboxItemDto }
  | { kind: 'mission'; id: string; mission: InboxMissionDto };

/** Bucket keys in display order. */
export type InboxTaskGroupKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'later'
  | 'no_date'
  | 'agent_next';

export const INBOX_TASK_GROUP_ORDER: InboxTaskGroupKey[] = [
  'overdue',
  'today',
  'tomorrow',
  'later',
  'no_date',
  'agent_next'
];

export type InboxTaskGroup = {
  key: InboxTaskGroupKey;
  rows: InboxTaskRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole UTC days between a due date and today, negative once the date has
 * passed. UTC day boundaries match the ones `GET /api/inbox/missions` uses to
 * decide `overdue` / `due_soon`, so the client never disagrees with the server
 * about which side of midnight a row sits on.
 */
export function dueDayOffset(dueDatetime: string | null, now: Date = new Date()): number | null {
  if (!dueDatetime) return null;
  const due = new Date(dueDatetime);
  if (Number.isNaN(due.getTime())) return null;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueDay - startOfToday) / DAY_MS);
}

/** `Overdue 1 day` / `Overdue 6 days`, or null when the date is not in the past. */
export function overdueLabel(dueDatetime: string | null, now: Date = new Date()): string | null {
  const offset = dueDayOffset(dueDatetime, now);
  if (offset === null || offset >= 0) return null;
  const days = -offset;
  return days === 1 ? 'Overdue 1 day' : `Overdue ${days} days`;
}

/** `Due today` / `Due tomorrow`, or null outside that window. */
export function dueSoonLabel(dueDatetime: string | null, now: Date = new Date()): string | null {
  const offset = dueDayOffset(dueDatetime, now);
  if (offset === 0) return 'Due today';
  if (offset === 1) return 'Due tomorrow';
  return null;
}

function groupKeyForDueDate(dueDatetime: string | null, now: Date): InboxTaskGroupKey | null {
  const offset = dueDayOffset(dueDatetime, now);
  if (offset === null) return null;
  if (offset < 0) return 'overdue';
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return 'later';
}

function rowDueDatetime(row: InboxTaskRow): string | null {
  return row.kind === 'task' ? row.item.dueDatetime : row.mission.dueDatetime;
}

function rowCreatedAt(row: InboxTaskRow): string {
  return row.kind === 'task' ? row.item.createdAt : row.mission.createdAt;
}

function dueTime(row: InboxTaskRow): number {
  const value = rowDueDatetime(row);
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function createdTime(row: InboxTaskRow): number {
  const time = new Date(rowCreatedAt(row)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Within a bucket, dated rows sort by due date (most recently missed first in
 * Overdue, soonest first elsewhere), then newest capture first so a freshly
 * added task lands where the eye already is. Captures precede missions when
 * everything else ties, since they are the rows only this page can act on.
 */
function compareRows(key: InboxTaskGroupKey) {
  return (a: InboxTaskRow, b: InboxTaskRow): number => {
    const byDue = key === 'overdue' ? dueTime(b) - dueTime(a) : dueTime(a) - dueTime(b);
    if (byDue !== 0) return byDue;
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1;
    return createdTime(b) - createdTime(a);
  };
}

/**
 * Bucket captures and triage missions by due state. A dated row always lands
 * by its date; an undated capture goes to `no_date` and an undated mission
 * (only agent-filed Next work reaches the Inbox without a date) to
 * `agent_next`. Empty buckets are omitted so the page only draws headers that
 * have rows beneath them.
 */
export function groupInboxTasks({
  items,
  missions,
  excludeItemIds = new Set<string>(),
  now = new Date()
}: {
  items: InboxItemDto[];
  missions: InboxMissionDto[];
  /** Captures the page is showing elsewhere (e.g. freshly promoted rows). */
  excludeItemIds?: ReadonlySet<string>;
  now?: Date;
}): InboxTaskGroup[] {
  const buckets = new Map<InboxTaskGroupKey, InboxTaskRow[]>();
  const push = (key: InboxTaskGroupKey, row: InboxTaskRow) => {
    const rows = buckets.get(key) ?? [];
    rows.push(row);
    buckets.set(key, rows);
  };

  for (const item of items) {
    if (excludeItemIds.has(item.id)) continue;
    push(groupKeyForDueDate(item.dueDatetime, now) ?? 'no_date', {
      kind: 'task',
      id: item.id,
      item
    });
  }

  for (const mission of missions) {
    push(groupKeyForDueDate(mission.dueDatetime, now) ?? 'agent_next', {
      kind: 'mission',
      id: mission.id,
      mission
    });
  }

  return INBOX_TASK_GROUP_ORDER.flatMap(key => {
    const rows = buckets.get(key);
    if (!rows || rows.length === 0) return [];
    return [{ key, rows: [...rows].sort(compareRows(key)) }];
  });
}

/**
 * ISO datetime for noon UTC on the day `offsetDays` from today, for quick-add
 * presets. Noon matches what `buildDueDatetime` stores for a freshly picked
 * date, so a preset and a picked date for the same day compare equal.
 */
export function dueDatetimeForDayOffset(offsetDays: number, now: Date = new Date()): string {
  const noonToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  return new Date(noonToday + offsetDays * DAY_MS).toISOString();
}
