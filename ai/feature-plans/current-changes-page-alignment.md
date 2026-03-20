# Current Changes Page Alignment Plan

## Objective

Update the production current changes view so it feels and behaves much closer to [`app/demo/DemoCurrentChangesPage.tsx`](/Users/jake/Development/Cooperativ/Overlord/app/demo/DemoCurrentChangesPage.tsx) while preserving the real page's Git-backed data and Electron-only constraints.

## Current State

- [`components/features/projects/CurrentChangesPage.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/CurrentChangesPage.tsx) already has the same high-level shell as the demo: header, left file list, right diff pane.
- The production page loads real Git status and diffs through the Electron filesystem bridge in [`electron/ipc/filesystem.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/ipc/filesystem.ts).
- Ticket context comes from two APIs:
  - [`app/api/projects/[projectId]/change-rationales/route.ts`](/Users/jake/Development/Cooperativ/Overlord/app/api/projects/[projectId]/change-rationales/route.ts) for hunk-level rationale records.
  - [`app/api/projects/[projectId]/file-attribution/route.ts`](/Users/jake/Development/Cooperativ/Overlord/app/api/projects/[projectId]/file-attribution/route.ts) for file-to-ticket attribution derived from delivery artifacts.
- The current UI emphasizes raw diff inspection and hunk popovers:
  - [`components/features/projects/current-changes/FileListPane.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/FileListPane.tsx)
  - [`components/features/projects/current-changes/FileListItem.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/FileListItem.tsx)
  - [`components/features/projects/current-changes/DiffPane.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/DiffPane.tsx)
- The demo page leads with review-ticket context, summarized file cards, and a prominent ticket/rationale summary above the diff.

## Gaps Between Demo and Production

1. The left rail is too low-context.
   The demo file cards show a human-readable summary, linked ticket, and `+/-` counts. The production cards only show file name, path, status, and rationale/ticket counts.

2. Ticket filtering is hidden.
   The demo makes ticket filters first-class inline chips. The production page hides filtering behind a popover, which makes the ticket-to-file relationship less legible.

3. The right pane does not surface ticket intent early enough.
   The demo immediately shows the selected ticket title, objective, and rationale summary. The production page requires clicking changed lines to discover most of that context.

4. The production page has no explicit file-level "primary ticket" model.
   The demo assumes a selected file maps cleanly to a selected review ticket. The real page can have multiple ticket attributions and multiple rationale rows for one file, but the UI does not resolve that into a clear primary context.

5. Some demo metadata is not available in the current view model.
   - `git status` currently does not provide `linesAdded` / `linesRemoved`.
   - The existing rationale route returns `ticket.id`, `ticket.title`, and `ticket.status`, but not `ticket.objective` or `ticket.recent_agent`.
   - The file list has no derived "summary" field; the closest current source is the latest rationale `summary`.

## Recommended Product Behavior

### Keep From Production

- Keep the Electron-only gating and the unavailable-state fallbacks.
- Keep the refresh action and branch badge in the page header.
- Keep the real unified diff rendering and hunk-level rationale linking.

### Bring Over From Demo

- Replace the low-context file list with richer cards that show:
  - full path
  - a short summary line
  - file status badge
  - primary linked ticket badge
  - `+/-` change counts
- Move ticket filters into a visible inline chip row above the file list.
- Add a summary panel above the diff that shows:
  - selected file path
  - linked ticket title and objective
  - primary rationale label
  - rationale `why`
  - rationale `impact`
  - recent agent when available
- Preserve multi-ticket support, but make the currently selected ticket explicit when a file has more than one attribution.

## Technical Plan

### 1. Introduce an enriched file view model

Add a derived view-model layer inside the current changes feature, for example in a new helper such as `current-changes/view-model.ts`, that merges:

- `GitStatusFile`
- related `ChangeRationaleRecord[]`
- related `FileAttribution[]`
- derived diff metadata

Each enriched file record should expose:

- `path`, `originalPath`, `status`
- `summary`
- `linesAdded`, `linesRemoved`
- `tickets`
- `primaryTicket`
- `primaryRationale`
- `rationaleCount`
- `attributionCount`

Recommended derivation rules:

- `summary`: prefer the newest rationale `summary`; otherwise fall back to a generated status string such as "Modified file with no linked rationale yet."
- `primaryTicket`: prefer the ticket attached to the newest rationale; fall back to the first file attribution.
- `primaryRationale`: prefer the newest rationale for the file.

This keeps the rendering components simple and removes ticket-selection heuristics from JSX.

### 2. Expand the rationale API payload

Extend [`app/api/projects/[projectId]/change-rationales/route.ts`](/Users/jake/Development/Cooperativ/Overlord/app/api/projects/[projectId]/change-rationales/route.ts) so the joined ticket payload includes:

- `objective`
- `recent_agent`

The schema already supports both on `tickets`, so this is a query-shape change rather than a new storage design.

This lets the production page render the demo-style context card without a second ticket lookup per selection.

### 3. Decide how to source `+/-` counts

This is the main implementation decision.

Recommended approach:

- Extend the Electron Git status bridge to return per-file line stats alongside status.
- Compute stats from Git directly in [`electron/ipc/filesystem.ts`](/Users/jake/Development/Cooperativ/Overlord/electron/ipc/filesystem.ts), ideally from a single lightweight command such as `git diff --numstat HEAD`.
- Return those counts through the preload/types layer so the page can render them without fetching every full diff eagerly.

Fallback approach if speed or complexity becomes an issue:

- Initially omit `+/-` counts from the first production redesign pass.
- Preserve the rest of the demo alignment and add counts in a follow-up ticket.

Do not fetch every full diff just to populate the left rail; that will scale poorly on larger working trees.

### 4. Replace the current file list composition

Refactor [`components/features/projects/current-changes/FileListPane.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/FileListPane.tsx) and [`components/features/projects/current-changes/FileListItem.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/FileListItem.tsx) to match the demo interaction model:

- visible ticket filter chips row
- richer card layout
- stronger selected-state treatment
- explicit empty states for:
  - no git changes
  - no files matching the selected ticket filters

Keep the popover as an overflow control only if the ticket list becomes too large; it should not remain the primary filter UI.

### 5. Add a selected-file summary panel above the diff

Refactor [`components/features/projects/current-changes/DiffPane.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/DiffPane.tsx) so the pane has two layers:

1. A top summary card modeled after the demo.
2. The existing diff viewer below it.

The summary card should render the selected file's:

- path
- primary ticket title
- ticket objective
- recent agent
- rationale label
- rationale why
- rationale impact

If a file has multiple linked tickets or rationales, add a compact switcher or badges in the summary card rather than hiding that state inside popovers.

### 6. Preserve hunk-level drill-down

Do not remove the current popover-based rationale drill-down in [`components/features/projects/current-changes/HunkPopoverContent.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/projects/current-changes/HunkPopoverContent.tsx).

The demo is better for overview and selection, but the production page already has a stronger detailed inspection model. The redesign should layer the demo's summary-first UX on top of that, not replace it with a shallower mock-style diff.

## Suggested Delivery Phases

### Phase 1: Data shaping

- Extend the rationale route to include `objective` and `recent_agent`.
- Add the enriched file view model and primary-ticket selection rules.
- Decide whether line stats are in scope for the same ticket.

### Phase 2: Left-rail redesign

- Replace the popover-first filtering UI with inline chips.
- Redesign file cards to show summary and primary ticket context.
- Add optional `+/-` stats if the Electron bridge work is included.

### Phase 3: Right-pane redesign

- Add the selected-file summary card above the diff.
- Keep the existing diff renderer and hunk popovers.
- Add clear handling for multi-ticket files.

### Phase 4: Polish and verification

- Verify responsiveness on narrower desktop widths.
- Verify renamed, deleted, and untracked files still render correctly.
- Verify files with no rationale still have a sensible fallback summary card.
- Verify large working trees do not regress initial load time.

## Acceptance Criteria

- The production current changes page visually reads much closer to the demo version.
- Users can filter by ticket without opening a popover first.
- Each file row exposes enough context to understand why the file changed before opening the diff.
- Selecting a file shows ticket objective and rationale context immediately above the diff.
- Hunk-level rationale inspection still works for changed lines.
- The redesign does not require loading every file diff eagerly.

## Open Decisions

- Whether `+/-` counts are required for the initial redesign or can follow after the structural UI refactor.
- How to represent files linked to multiple tickets:
  - single primary ticket with secondary badges
  - explicit ticket switcher in the summary card
- Whether the page should default to showing only review/active tickets when ticket metadata is available, or continue showing every uncommitted file and use filters only as an aid.
