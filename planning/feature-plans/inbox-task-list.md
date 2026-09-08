# Inbox as a task list (coo:964)

## Goal

Keep `inbox_items` as the lightweight, private capture it already is, but present the
Inbox as a task list rather than a stack of editor cards: one line per task, due dates
editable in place, quick capture at the top, and project assignment (which converts the
capture into a mission) reachable from the row itself.

## Data model

Unchanged. `InboxItemDto` already carries `dueDatetime` and `priority`; promotion still
goes through `POST /api/inbox/:id/promote`, which creates an ordinary mission in the chosen
project and consumes the item atomically. No contract, backend, or migration changes.

## Design

The page mirrors the mission list view (`MissionListStatusGroup` / `MissionListCard`):
the same header chrome (icon, label, tinted rule, count, "+"), the same rail, and rows
with the same checkbox / title / trailing-metadata rhythm.

Rows come from two sources and share one set of buckets ordered by due state:

| Bucket      | Contents                                                             |
| ----------- | -------------------------------------------------------------------- |
| Overdue     | dated captures and triage missions whose UTC due day has passed      |
| Today       | due today (UTC)                                                      |
| Tomorrow    | due tomorrow (UTC)                                                   |
| Later       | dated further out                                                    |
| No due date | undated captures                                                     |
| Agent Next  | undated agent-filed Next missions                                    |

UTC day boundaries match the ones `GET /api/inbox/missions` uses for `overdue` /
`due_soon`, so client and server never disagree about which bucket a row sits in.

### Task row (`inbox_items`)

- Checkbox: completes the task. A private capture has no "done" state, so completing
  removes it after a five-second Undo window. Leaving the page flushes pending removals.
- Title, with any lines after the first previewed faintly.
- Trailing: project assign (icon on hover; picking a project promotes immediately),
  due-date pill (the `badge` size of `DueDatePickerButton`, same look as
  `MissionDueDateBadge`), delete on hover.
- Click expands the existing `InboxMissionCard` editor beneath the row for the long
  form: full instruction text, project, resource, agent/model, Save, Run.

### Promoted row

A capture assigned a project on this visit stays in the list as a mission row (so the eye
does not lose it) and expands into the promoted card, which keeps agent/resource/Run one
click away. It is excluded from the triage buckets so it never appears twice.

### Triage mission row

Agent-Next, overdue, and due-soon missions render as rows with project chip, display id,
due pill, origin sparkle, and a reason subtitle. Click opens the mission page; the checkbox
completes it in place via the project's `complete` status.

### Quick add

A single-line input at the top. Enter adds and keeps focus; the due date sticks between
adds. A bucket header's "+" pre-fills the matching due date (Today, Tomorrow, Later = +7
days) and focuses the input.

## Files

- `webapp/web/components/inbox-tasks/inbox-task-groups.ts` — pure bucketing/sorting (+ tests)
- `webapp/web/components/inbox-tasks/inbox-task-group-styles.ts` — bucket presentation
- `webapp/web/components/inbox-tasks/InboxTaskGroup.tsx` — group header + rail
- `webapp/web/components/inbox-tasks/InboxTaskRow.tsx` — capture row with inline editor
- `webapp/web/components/inbox-tasks/InboxMissionRow.tsx` — triage and promoted mission rows
- `webapp/web/components/inbox-tasks/InboxProjectAssignMenu.tsx` — row-level project picker
- `webapp/web/components/inbox-tasks/InboxQuickAdd.tsx` — top-of-list capture
- `webapp/web/components/inbox-tasks/InboxTaskList.tsx` — state owner (expand, undo, promoted)
- `webapp/web/pages/InboxPage.tsx` — page shell
- `webapp/web/components/scheduling/DueDatePickerButton.tsx` — new `badge` size
- `webapp/web/lib/due-datetime.ts` — `formatOrdinalDayOfMonth` shared with list primitives

## Deferred

- Priority on captures exists in the DTO but has no row affordance yet.
- Drag-to-reorder within a bucket; captures have no stored position.
- Recurring or time-of-day due dates on captures.
