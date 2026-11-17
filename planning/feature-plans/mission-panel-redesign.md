# Mission panel redesign (web and desktop): implementation plan

Date: 2026-11-16. Status: approved for ordered implementation on coo:1281. This document makes no runtime changes.

Design source: the canvas "Mission Panel Redesign" (https://claude.ai/artifact/Rq4Ftbum7aF8yiBpfSh3wH), artboards *Desktop · mission panel (interactive)*, *Desktop · objective detail modal* and *Mobile · objective detail (full screen)*. Where this plan and the canvas differ, this plan wins; section 12 lists every known difference.

Contract impact: minor

The implementation adds an opt-in, filtered and paginated agent-request read surface so every open question remains discoverable. Existing unfiltered callers retain newest-first, at-most-200 behavior. Update `contract/api/openapi.yaml`, generated API artifacts and any affected normative prose alongside the backend implementation; use `yarn version:contract minor`, update the OpenAPI version and changelog, and add an ADR where required by the contract. Never type a contract version by hand. CLI and mobile retain their current request behavior; the web client opts into the extension. No new objective vocabulary, protocol command, authorization rule or reinterpretation of stored summary-seen data is planned.

This document specifies the final agreed behavior. Plan editing itself changes no runtime contract. The source canvas was inaccessible during review; visual comparison remains part of final verification, with this plan authoritative where they differ.

Rollout: ordered implementation objectives, one final integrated release. Each objective leaves the tree compiling; temporary reuse of existing components is allowed until their replacements are integrated. No feature flag or separately released intermediate redesign is required. All retired components are removed before final verification. Deployment is not part of these objectives.

## 1. Product result

The mission panel is reorganised so that the thing a person most needs is always nearest the top.

1. An open blocking question sits directly under the title and settings rows, with its answer form.
2. Below it is one card that combines the mission summary and the objective list. The top of the card reads like a feed mission card (context line, state badge, headline, short summary). Its footer is a compact, one-line-per-objective list.
3. The new-objective composer floats at the bottom of the panel's viewport while the objective list is on screen and settles at the end of the list once the user scrolls past it.
4. Clicking an objective opens its detail in a dialog centred on the screen at nearly full height. Below 768px wide the same content is a full-screen view.
5. The Latch terminal session is one click away from the panel header at all times.
6. Notes, artifacts, activity and unassigned evidence follow, unchanged.

Objective rows no longer expand in place. Everything a row used to reveal (instructions, summary, deliveries, file changes, earlier runs, attachments, terminal session, launch controls) lives in the objective detail.

## 2. Scope

In scope:

- `webapp/web`, which serves both the browser app and the desktop shell.
- The additive backend agent-request query, contract and generated client changes in section 3.1.
- Feed mission/objective navigation in section 9.1.
- Viewports from 375px (the panel's existing minimum) upward. Below 768px only the objective detail changes shape (full screen); the panel itself keeps today's drawer behaviour.

Out of scope:

- The Swift app in the OverlordMobile repository. The mobile artboard is used here only for the web app's narrow-viewport objective detail.
- Any change to how the mission drawer behaves on narrow viewports (it stays a side-by-side drawer with a 375px minimum).
- CLI, connectors, MCP and native mobile UI changes. Existing consumers retain compatible behavior.
- Feed changes other than the shared state icon and mission/objective navigation in section 9.1.

## 3. Preconditions and data sources

### 3.1 API prerequisites and compatibility

1. Confirmed: a person can edit an objective's title. `UpdateObjectiveBody.title` is `string | null` ("Blank or null clears it") in `packages/contract/src/generated/api.ts`. No contract change is needed for title editing.
2. The current mission-wide request query includes pending-delivery objectives, but returns only the newest 200 requests of all statuses (`backend/agent-session-routes.ts:723`; `contract/api/openapi.yaml`, `getAgentRequests`). Client-side filtering cannot recover old open questions displaced by newer resolved ones.
3. Extend that read API with opt-in open-status filtering and cursor pagination plus explicit completion metadata. Apply status filtering before the limit; use a stable total order (timestamp and ID), bounded pages, scoped/validated cursors and existing mission/workspace authorization. Keep the current unfiltered default behavior and existing response members compatible. The implementation chooses exact parameter names and documents them in OpenAPI. Include both question and choice requests, pending-delivery objectives and optional objective filtering.
4. Add a web query that consumes all open-request pages, deduplicates IDs, and exposes loading, partial/error and complete states. Poll/refetch a coherent collection, invalidate it after answers and realtime changes, and handle arrivals/resolutions during paging without treating a partial result as authoritative absence. Preserve the last successful view during transient failure, indicate stale/partial data with retry, and do not falsely claim that no questions remain. Never authorize dismissal pruning or acknowledgement from incomplete data.
5. Title editing uses the existing update route. Summary eligibility stays unchanged: the feature migration disabled summaries for pre-existing missions; newly created missions default to eligible. No backfill or eligibility change is required for this redesign.
### 3.2 Data each new piece reads

| Piece | Source (all existing) |
| --- | --- |
| Blocking question slot | the complete mission-wide open-request query from 3.1, filtered with `isPendingBlockingRequest` (`lib/objective-blocking-requests.ts`) |
| Blocked state per row | the same mission-wide request list, grouped by `objectiveId`; no per-objective query |
| Summary card header | `useMissionSummary`, and the derivations already used by `MissionSummarySection` (`lib/mission-summary-derive.ts`) |
| Objective list and order | `deriveObjectiveLifecycleView` from `@overlord/automations/objective-manager`, exactly as `MissionObjectivesSection` uses it today |
| Reorder | `useReorderObjectives` → `PATCH /api/missions/:id/objectives/reorder` with the complete draft-and-submitted set |
| Objective detail evidence | `partitionMissionEvidence` output already computed in `MissionPanel`, `useObjectiveFileChanges`, `useObjectiveAttachments` |
| Latch chip and popover | `mission.terminalSessions` through the existing `MissionLatchSessionProvider` |

One mission-wide open-request collection replaces per-row `useAgentSessionFeed` polling. `ObjectiveBlockingQuestions` consumes that same collection grouped by objective; the detail has no `AgentSessionActivity`. Keep the 5s polling plus realtime invalidation behavior, with loading/completeness/error state shared by the top notifications, row tints and detail. Loading is independent of summary eligibility.

### 3.3 State vocabulary

The canvas uses "draft" and "queued" loosely. The implementation uses the real states:

| Term in this plan | Meaning |
| --- | --- |
| Not started | `state` is `draft` or `submitted`. This is the reorderable set and the set `ReorderObjectivesBody` must list in full. |
| In the Run Queue | `objective.queueEntry !== null`, whatever the state |
| Launching | `state === 'launching'` |
| In flight | `state` is `executing` or `pending_delivery` |
| Blocked | in flight, with at least one open `question` or `choice` request |
| Complete | `state === 'complete'` |

"Draft objective" in the review conversation maps to **not started** throughout.

## 4. New panel structure

`MissionPanel.tsx` keeps its header, title, settings bar and tag row as fixed (non-scrolling) regions, and keeps the footer. The scroll container's children change to, in order:

1. `MissionBlockingQuestions` (section 5), rendered only when there is an open request.
2. A wrapper `div` containing:
   1. `MissionOverviewCard` (section 6), which contains the objective list (section 7);
   2. the sticky composer (section 8).
3. `MissionNotes`.
4. Artifacts.
5. Activity (with the existing Disconnect control).
6. The evidence-load error line and `UnassignedEvidenceSection`.

Removed from the scroll area: `MissionTerminalSessionsSection` (moves to the header, section 10) and the standalone `MissionSummarySection` block (absorbed into the overview card).

`MissionLatchSessionProvider` and `MissionDeliveryVariantProvider` must wrap the header as well as the scroll area, because the Latch chip now lives in the header. Move both providers up to wrap the whole panel body.

The objective detail (section 9) is mounted once at panel level, not per row.

## 5. Blocking questions under the title

New component `webapp/web/components/mission-panel/MissionBlockingQuestions.tsx`.

- Reads the mission-wide request list (3.2) and renders one card per open request, oldest first.
- Each card reuses the existing `BlockingQuestionCard` from `components/agent-session/` for a `question` and the existing choice card used by `AgentSessionActivity` for a `choice`. Do not fork the answer form; `QuestionAnswerForm` stays the single implementation, including its read-only reason for non-Latch sessions, the expiry countdown, the lost-race message and delivery state text.
- Each card's header adds the objective's display id as a button that opens that objective's detail.
- More than two open requests: show the two oldest and a "Show n more" disclosure, so a burst of questions cannot push the objective list off screen.
- The slot scrolls with the content; it is not pinned. The row tint (7.3) keeps the blocked objective findable after the slot scrolls away.
- Each card has a dismiss button (✕, "Dismiss this notification"). Dismissing hides that request's card from the top of the mission panel and from the top of the objective detail (9.4), and nothing else:
  - the request stays open and answerable;
  - the objective's row keeps its yellow tint and blocked icon, and the overview card's badge still reads "waiting on you";
  - the request stays in the objective detail's Blocking questions list as a highlighted item that expands to the full question (9.7), and in the "For you" tab (6.2).
- Dismissal is per request id, so a new question from the agent shows again without extra bookkeeping. Keep the ids in one small client store shared by the panel and the detail (`lib/dismissed-agent-requests.ts`), persisted in `localStorage` so a reload does not bring a dismissed card back. Namespace storage by backend, account, workspace and mission. Prune only on an authoritative complete successful result for that scope or an explicit terminal-status event; never prune on loading, query failure, partial pagination or navigation to another mission. Tolerate unavailable localStorage with an in-memory fallback. Clear/switch the active scope on account or backend changes. This replaces the per-row dismissal state in `ObjectiveCollapsibleItem`.
- When the last open, undismissed request resolves or is dismissed, the slot unmounts. Use the mission-wide query's data directly so the card disappears on the same refetch that clears the row tint.

`MissionSummarySection` currently receives open questions for its watermark and "Your actions" derivations. Keep feeding it the same list. A question therefore appears both in this slot and as a row in the "For you" tab; that is intended, since the tab is where a dismissed question is still listed at mission level. The row's link opens the objective detail.

## 6. Mission overview card

New component `webapp/web/components/mission-panel/MissionOverviewCard.tsx`. It replaces `MissionSummarySection` as the thing `MissionPanel` renders, and reuses that component's hooks and child components.

### 6.1 Header region

Styled after `MissionRunCard` (`rounded-xl border bg-(--color-surface-1)`, the same type sizes):

| Line | Content | Source |
| --- | --- | --- |
| Context | project dot and name · mission display id · clock with "Summary updated <relative time>" | `ProjectDot`, `mission.displayId`, `summary.generatedAt` |
| Headline | a `KindBadge` and the summary headline, one line, truncated | badge from mission run state (below); headline from the summary |
| Summary | the summary paragraph, clamped to three lines with "Show more" | `MissionSummaryPost` content |
| Tabs | the tab row that selects what the card's lower half shows | 6.2 |

Badge: `question` tone and "waiting on you" when any objective is blocked; otherwise `running`/"executing" when any objective is in flight; `launching` when one is launching; `delivered`/"complete" when the mission's status type is done; no badge otherwise.

Every state `MissionSummarySection` handles today must still be handled, because the card also carries the objective list and so can never be hidden:

| Summary state | Header region shows |
| --- | --- |
| `hidden` (mission not summary-eligible) | context line and badge only; headline is the mission title; no summary text; the tab row has Objectives and, when open questions exist, For you; summary-dependent tabs stay absent |
| `awaiting` | context line, badge, and the existing "The summary appears after the first delivery" copy |
| `error` | context line, badge, the existing error line |
| `first_pending` / updating | the existing `UpdatingStrip` at the top of the card, content dimmed as today |
| `summary` | everything in the table above |

Keep `key={mission.id}` and the frozen visit baseline, but do not acknowledge the global watermark merely because the header is visible. Unopened For you or Risks content remains new on the next visit. Track evidence coverage during this visit: a nonempty evidence tab counts only after its content has actually been displayed for the existing two-second foreground visibility interval. Gate the existing monotonic global acknowledgement until all evidence-bearing tab groups represented by that snapshot have been displayed, plus the header/source evidence. This deliberately conservative gate keeps the existing persisted meaning; it adds no per-tab persistence. A new or changed evidence group invalidates its coverage; acknowledgement uses the covered response watermark, never wall-clock time. Do not count hidden tabs, loading/partial/error results, a background page, or the overview obscured by the objective dialog. Unmounting before the interval completes cancels it. Reuse the existing hook after making its visibility/coverage inputs explicit; a timestamp-only `summaryWatermarkIsDisplayed` check is insufficient once sections are tabs.

### 6.2 Tabs

The row of buttons under the summary is a tab row, not a set of filters. Selecting a tab replaces what the card's lower half shows. Objectives is selected by default and whenever the mission changes.

| Tab | Label and count | Colour (the summary's existing coding) | Lower half shows |
| --- | --- | --- | --- |
| Objectives | "Objectives", completed/total | neutral ink | the objective list (section 7) |
| For you | "For you", n | sky; the same sky as the action glyph and details rule in `MissionSummaryActions` | `MissionSummaryActions`, today's "Your actions" section (question and choice rows keep their amber chip, blocking actions their red chip) |
| Risks | "Risks", n | red, as `MissionSummaryRisks` | `MissionSummaryRisks` |
| Suggested | "Suggested", n | violet, as the rule in `MissionSummarySuggestions` | `MissionSummarySuggestions`, today's "Suggested next" (deferred work) section |
| Resolved | "Resolved", n | neutral grey | `MissionSummaryResolved` |
| Files | "Files", n | neutral grey | `MissionSummaryFiles`, today's "Files changed" section |

Tab labels are as decided in review: "For you", "Suggested" and "Files" replace the section headings "Your actions", "Suggested next" and "Files changed". Elsewhere in this plan, "the For you tab" is the tab that holds the actions list.

Rules:

- Each tab is a pill. Unselected: tinted background, matching border and dark text in its colour. Selected: filled with the strong shade of its colour and light text. Selection is therefore shown by fill, not by hue, so it reads for colour-blind users; every pairing must pass 4.5:1 in light and dark.
- Define the colours once as a tone map (`ink`, `sky`, `red`, `violet`, `grey`), in light and dark, next to the existing `KindBadge` tones; do not scatter class strings.
- A tab with a zero count is hidden, except Objectives, which always shows. If the selected tab's count drops to zero (the last risk is resolved), selection returns to Objectives.
- Markup: `role="tablist"` with `role="tab"` buttons and `aria-selected`, arrow-key movement, and the lower half as `role="tabpanel"`. The row wraps at narrow panel widths.
- The five summary components are reused unchanged for their rows, mutations, truncation notices and item controls. Remove each one's own top border and `SummaryBlockHeading` when rendered in a tab (a `headless` prop), since the tab already names the section.
- A new item arriving in a tab that is not selected shows the existing `NewDot` on that tab.
- The selected tab is local UI state, not in the URL. For you is derived from open questions independently of summary eligibility, including older summary-ineligible missions; no summary is required to find a dismissed question here.
- The sticky composer (section 8) is shown on every tab.

### 6.3 Shared state icon

Move `ObjectiveStateIcon` out of `components/activity-feed/MissionRunCard.tsx` into `components/objectives/ObjectiveStateIcon.tsx` and import it from both places, so the feed and the panel cannot drift. Extend it with a `blocked` prop (amber `HelpCircle`). No visual change to the feed.

### 6.4 Lower half

`border-t`, `bg-(--color-surface-2)`, holding the selected tab's panel. With no objectives the Objectives panel shows only "No objectives yet"; the composer below is where the first one is written.

## 7. Objective rows

New component `webapp/web/components/objectives/ObjectiveRow.tsx`, rendered by a rewritten `MissionObjectivesSection.tsx`. It replaces both `ObjectiveCollapsibleItem` (in-flight and complete rows) and `DraftObjective` cards (launching and not-started objectives). Every objective, in every state, is one row of the same shape.

### 7.1 Order

Unchanged from today, from `deriveObjectiveLifecycleView`: `executedObjectives` (history order), then `launchingObjectives`, then the not-started objectives in queue order (`queuedObjectives`, with the existing optimistic local order and `mergeQueuedObjectiveOrder`). The existing `committingObjectiveId` filter stays, so the composer's objective never appears twice.

### 7.2 Row anatomy

A row is an `<li>` at least 36px tall. Left to right:

| # | Element | Shown when | Looks like | Click / interaction |
| --- | --- | --- | --- | --- |
| 1 | State icon | always | shared `ObjectiveStateIcon` | none; it is part of the row button |
| 2 | Title | always | one line, truncated | part of the row button |
| 3 | Row button | always | invisible button spanning the icon and title | opens the objective detail; hold and drag reorders when not started |
| 4 | Queue button | in the Run Queue: always. Not started and not queued: on hover or focus only | `ListOrdered` icon, no text; emerald when queued, grey when not | opens the Run Queue popover (queued view or add view) |
| 5 | Identifier button | `displayId` present | short key in mono, e.g. `rjay` | copies the full identifier |
| 6 | Agent | always | `AgentIcon` | not started: opens the agent selector; otherwise static with a tooltip |
| 7 | Menu button | always | three vertical dots, far right | opens the objective menu |

There is no Run button and no terminal button on the row. Both actions are in the objective detail (section 9) and the terminal is also in the header (section 10).

Elements 4 to 7 are siblings of the row button, not children of it, so no interactive element is nested inside another. Each stops propagation so it never opens the detail.

#### 1. State icon

| Condition | Icon |
| --- | --- |
| blocked | amber `HelpCircle`, label "Waiting on an answer" |
| `executing` | `StatusSpinner` |
| `pending_delivery` | `StatusSpinner` with `RefreshCw`, slow |
| `launching` | sky `Rocket` |
| `complete` | emerald `CheckCircle2` |
| `draft`, `submitted` | hollow `Circle` |

Each carries an accessible label naming the state.

#### 2. Title

`objective.title`, else the first line of `instructionText`, else "Untitled objective". Complete rows use the dim ink colour; in-flight rows use medium weight. While `titleStatus === 'pending'` show the fallback text; do not show a skeleton. The native tooltip keeps today's timestamp text ("Executing since …", "Completed …").

#### 3. Row button

- Click, Enter or Space: open the objective detail for this objective (section 9.1).
- Not-started rows only: press and hold, then drag, to reorder (section 7.4). A press shorter than the hold delay is a click.
- `title`: "Click to open" (all rows); "Click to open. Hold and drag to reorder." (not started).

#### 4. Queue button

The Run Queue popover that today lives inside `DraftObjectiveActions.tsx` (lines 141 onward) is extracted, unchanged in content and behaviour, into `components/objectives/ObjectiveQueuePopover.tsx`:

- queued view: "<status> · <queue name>", "Position n", any status detail and note, Retry when `canRetry`, the Queue select (moves the entry), "Remove from queue" with its confirmation, and the in-flight variant with "Force-remove from queue";
- add view: "Add to Run Queue", the predecessor sentence, "Every objective after this one in the mission is queued with it", the Queue select, and the add button.

On the row:

- Queued (the objective has a queue entry): the button is always visible. Colour: emerald normally, amber when `describeQueueEntry(queueEntry).tone === 'blocked'`. `aria-label` and `title`: "Queued · <status label>" plus the detail when present, as today. Click opens the queued view.
- Not queued, state `draft` or `submitted`: the button is in the DOM but invisible (`opacity-0`) until the row is hovered, any control in the row has keyboard focus (`group-hover` / `group-focus-within`), or its popover is open. It is grey (`text-muted-foreground`). `aria-label` and `title`: "Add to Run Queue". Click opens the add view. Keeping it in the DOM reserves its width, so the identifier does not shift on hover, and keeps it reachable by keyboard.
- Not queued, any other state: no button and no reserved space.
- While an enqueue, dequeue, move or retry is pending the button shows a spinner and stays visible.
- There is no "Queued" text on the row.
- Touch devices have no hover. There the grey button is not shown; the menu's "Add to queue…" item (7.2 #7) is the way to queue an objective.

#### 5. Identifier button

- Label: the part of `displayId` after the last `.`.
- Click: copy the full `displayId` (fall back to `objective.id` when there is no display id) with `useCopyToClipboard`. For about 1.2 seconds the label reads "Copied" in emerald, then reverts. Reserve a minimum width so the row does not shift.
- `aria-label` and `title`: "Copy <full display id>".
- This replaces the copy icon button on today's executed rows.

#### 6. Agent

- Icon: `AgentIcon` for `objective.assignedAgent`. With no agent, or an agent with no icon, show the `User` icon (the same mark the selector uses for Manual).
- Not started (`draft`, `submitted`): the icon is a button. It opens the existing agent selector (`AgentModelSelector`: Agent, Model, and Thinking columns, plus the launch-config commit) in a popover. Implement by giving `AgentModelChooserButton` an icon-only trigger variant; state and persistence stay in `useObjectiveAgentSelection`. `aria-label`: "Change agent, currently <agent label> · <model label>".
- `launching`, in flight, complete: a static icon with the existing tooltip text "<agent label> · <model label>". Not focusable as a button.

#### 7. Menu button

One menu for every state: `ObjectiveMenuButton`, extended to absorb the menu currently in `DraftObjectiveActions`. Items, in order, with separators between groups:

| Item | Shown when | Behaviour |
| --- | --- | --- |
| Copy objective ID | always | copies `displayId` (existing) |
| Copy resume command | `buildAgentResumeCommand` returns one | existing |
| Copy session ID | `externalSessionId` present | existing |
| Edit title | always (subject to 3.1) | opens the objective detail with the title in edit mode |
| Move up / Move down | not started, and not already first / last of the not-started set | reorders by one place through the same mutation as dragging; this is the keyboard path for reordering |
| Add to queue… | `queueEntry === null` and state is `draft`, `submitted`, `launching`, `executing` or `pending_delivery` | opens `ObjectiveQueuePopover` in its add view, anchored to the row. Kept alongside the hover icon because touch and in-flight rows have no hover icon |
| Mark complete | `state !== 'complete'` | existing |
| Mark draft | `state !== 'draft'` | existing, including the two confirmations (executing: ends the session; complete: reopening keeps evidence) |
| Force disconnect | `state === 'executing'` | the existing confirmation dialog from `ObjectiveCollapsibleItem`, moved into the menu component |
| Delete | always | existing `confirm()` then delete; if the deleted objective's detail is open, close it |

`aria-label` stays "Objective options".

### 7.3 Row tints

- Blocked: the solid yellow highlight the feed card uses (`bg-yellow-300/60 dark:bg-yellow-400/25`).
- In flight and not blocked: `ExecutingShimmer`, as today.
- Being dragged: lifted (surface background, outline, shadow).
- The objective whose detail is open: a subtle `bg-muted` wash, so the list shows which one the dialog belongs to.
- `?objective=` focus ring is no longer needed (section 9.1).

### 7.4 Reordering

`@dnd-kit` stays. Changes from today:

- The drag listeners move from the grip handle onto the row button. Delete the grip and `SortableQueuedObjective`.
- New sensor set in `components/objectives/objective-row-dnd.ts` (do not change the board's `useKanbanSensors`):
  - mouse: `activationConstraint: { delay: 250, tolerance: 6 }`, so a drag starts only after a hold, and moving more than 6px before the delay cancels it;
  - touch: `{ delay: 250, tolerance: 8 }` (the board's existing values), with `KANBAN_TOUCH_DRAGGABLE_CLASS` on the row so a swipe still scrolls the panel and a long press does not select text or raise the iOS callout;
  - no keyboard sensor, because Space and Enter on the row open the detail. Keyboard reordering is the menu's Move up / Move down.
- Only not-started rows are sortable items. Executed and launching rows render outside the `SortableContext`.
- After a drag ends, swallow the click that follows the pointer release (capture-phase guard for one tick) so dropping never opens the detail.
- `handleDragEnd`, the optimistic `queueOrder` state, the full-set request body and the rollback on error (including a 409 for a stale set) are kept as they are.
- Use `restrictToVerticalAxis` and `restrictToParentElement` modifiers (add `@dnd-kit/modifiers` if it is not already a dependency) so a row cannot be dragged out of the list.

### 7.5 What rows no longer show

These were on the executed row's second line or the draft card and now appear only in the objective detail: resource label, origin mark, attachment count, decision-mention badges, evidence badges (deliveries, file count, duration), the instruction and summary previews, and the launch controls.

## 8. Sticky composer

- The composer is the existing `GhostObjective`, always rendered, whichever tab of the overview card is selected (6.2). Switching tabs must not remount it, so text the user has typed survives. Remove the `showComposer` condition, the `extraSlotRequested` state and the "+ Add objective" button. Keep `onCommittingChange` and the commit-on-leave behaviour, the disabled Run with its tooltip, mentions, attachments, resource and agent pickers.
- **Superseded by coo:1289 (Save → Run composer).** The composer is now `ObjectiveComposer`. The unsaved `GhostObjective` shows **Save** in the Run slot (disabled while empty) instead of the disabled Run; Save, Cmd/Ctrl+Enter or leaving the card creates the objective. The saved objective then stays in the composer as `ComposerSavedObjective` with the full saved toolbar (id, actions menu, Run Queue, resource, agent/model, split Run). Edited text shows Save; saved text shows Run with a green label and filled play icon (Run is green everywhere it is enabled). The held objective is hidden from the rows (`committingObjectiveId`) until it is released: by leaving the mission panel, by the "+ Add objective" button under it (which also presents a fresh composer), or automatically when it is deleted or starts executing.
- It is the last child of the wrapper that also holds the overview card (section 4), with `position: sticky; bottom: 0` and a z-index above the card. Because its containing block ends where the wrapper ends, it stays at the bottom of the scroll viewport while any part of the card is visible above it and scrolls away with the end of the list. No scroll listener is needed.
- Appearance while floating: the composer card only. No band, no backdrop, no shadow on the wrapper. The card gets a solid border (replacing the dashed outline) and its own soft shadow. Vertical padding of 12px around it comes from a transparent wrapper.
- The bottom of the selected tab must always be reachable. The composer follows the overview card in normal flow and only sticks while the card extends below the viewport, so once the user scrolls to the end of the card the composer sits beneath it and covers nothing. This holds for every tab, whatever its height, with no per-tab padding to maintain. Requirements that keep it true:
  - the composer stays in flow (never `position: fixed` or absolutely positioned);
  - the wrapper has no fixed height and no `overflow` of its own;
  - the composer's own height can change (multi-line text, attachments, the upload-failed row) without clipping the card, which the in-flow layout gives for free.
- Verify on each tab, with a short and a long list, that the last row is fully visible above the composer at the end of the scroll, including with a tall composer (several lines of text and attachments).
- A short tab (one risk, say) leaves the card shorter than the viewport. The composer then simply sits under the card, not at the viewport's bottom edge; that is the intended "settled" position.
- `autoFocus` is no longer driven by a button. Do not focus the composer on panel open.
- Popups the composer opens (mention menu, resource picker, agent chooser) already portal; confirm they open upward when the composer is at the bottom edge.

## 9. Objective detail

New directory `webapp/web/components/objective-detail/`.

### 9.1 Opening, closing and the URL

- Which objective is open is the existing `?objective=<displayId>` search parameter (`lib/mission-panel-search.ts`); retain UUID compatibility. Use one navigation helper for rows, summary links, feed links and close actions. Opening from the mounted mission pushes a detail entry; previous/next replace that entry. Track that locally created entry in router history state. Explicit Close returns to the mission-only entry when it exists; for direct/copied/feed entry without that entry, replace with the mission-only URL. Closing must not leave an obsolete detail entry that Back reopens. Browser Back follows actual history: it reveals the mission for a locally opened detail and can return to the previous page for direct/feed entry. Do not synthesize a mission history entry for a direct link.
- Any link that names an objective opens the mission with that objective's detail showing, in place of scrolling to a row and ringing it. Delete `ObjectiveFocusAnchor` and the auto-open effects in `MissionObjectivesSection` (deep link, start of execution, new request).
- Feed cards (decided in review):
  - Clicking the main body of a mission card (`MissionRunCard`'s header button) opens the mission only. It must stop passing `objectiveDisplayId` to `onOpenMission`.
  - Clicking an individual objective row in the card's footer opens that objective: the mission panel with `?objective=<that row's display id>`. Each `MissionObjectiveRow` becomes a button (it is a plain list item today) with an accessible name of the objective title.
  - The feed's `BlockingQuestionCard` is about one objective, so its open action keeps passing the objective and lands on the detail, where the question is.
- `useFocusObjective` / `ObjectiveKeyLink` in `MissionSummaryParts.tsx` (the objective links inside the summary tabs) change from "scroll to and ring the row" to "open the detail"; replace their current `replace: true` navigation and scroll branch with the shared navigation helper so all in-panel entry points have the same push behavior.
- An `?objective=` value that matches no objective on the mission is removed with replace only after mission/objective loading succeeds; loading or request failure is not proof of an invalid link.
- The desktop shell route parser (`parseDesktopMissionShellRoute`) is unchanged.
- Closing: the close button, Escape, a click on the backdrop, and browser back, subject to edit handling in 9.8. Explicit Close always reveals the mission. Escape first dismisses the active popup or cancels the active editor's unsaved draft without closing the detail; a subsequent Escape closes the detail. Already acknowledged autosaves are not undone by cancellation.

### 9.2 Container

`ObjectiveDetail.tsx` picks the container with the existing `useIsMobile()` hook (768px):

- 768px and wider: `Dialog` from `components/ui/dialog.tsx` with a `className` override on `DialogContent`: width `min(960px, 100vw - 48px)`, height `calc(100dvh - 48px)`, `sm:max-w-none`, no padding, `flex flex-col overflow-hidden`, `showCloseButton={false}` (the header has its own). Add a named class constant for this size next to the component; do not add a size variant to the shared dialog for one caller.
- Below 768px: the same `Dialog`, layered over the mission panel and covering it (`inset-0 top-0 left-0`, `h-dvh w-screen max-w-none sm:max-w-none rounded-none translate-x-0 translate-y-0`), with the mobile header and bottom bar from 9.5. The mission panel stays mounted underneath and is unchanged; explicit Close/the detail's back button and dialog-level Escape reveal it again with its scroll position and selected tab intact. Browser Back follows section 9.1.

It portals to the document body, so desktop positioning is relative to the screen. The mobile override must neutralize the shared dialog translations and responsive max width, not just set inset/size. Respect safe-area insets and the software keyboard; the content and fixed action bar must remain reachable at 375px, 640px and 767px.

### 9.3 Header

- Identifier button (full display id; same copy behaviour as the row).
- State badge: "Waiting on you" (amber) when blocked, otherwise the state label.
- "n of m" position within the row order.
- Previous / next objective buttons, following the row order, wrapping at the ends. Desktop uses up and down chevrons to match the vertical list.
- The objective menu (the same `ObjectiveMenuButton`, minus "Edit title").
- Close.
- Title: `InlineEditField`, saving `title` through `useUpdateObjective` (subject to 3.1 and 9.8). Provide a keyboard-operable edit button/trigger; the current static clickable span is not sufficient. Give the dialog an accessible `DialogTitle` or equivalent labelled relationship.

### 9.4 Body, 768px and wider

Two columns. The left column scrolls; the right column is 272px, `bg-(--color-surface-2)`, and scrolls independently.

Left column, in order:

1. Blocking question and choice cards for this objective's open requests that have not been dismissed, in flight only. Each has the same dismiss button as the mission-level card and shares its dismissal store (section 5), so dismissing in either place hides both.
2. Summary and Instructions tabs (9.6).
3. Attachments. Not started: the drop zone, list and upload trigger from `ObjectiveAttachments.tsx`. Otherwise the read-only list.
4. Blocking questions (9.7), only when the objective has at least one open blocking question. An open question always appears here, dismissed or not.
5. Deliveries, file changes ("live" tag while in flight) and earlier runs: `ObjectiveEvidenceSections`, given a new `layout="detail"` prop that omits the parts now rendered elsewhere (`ObjectiveInstruction`, `AgentSessionActivity`, the terminal session line, attachments). Existing callers are unaffected by the default.
6. Not started with no history: the note "Nothing has run yet. Deliveries and file changes appear here once this objective starts."

There is no Activity list in the objective detail.

Right column, in order:

1. Agent and model. Not started: the full `AgentModelChooserButton`. Otherwise read-only.
2. Resource. Not started: `ObjectiveResourcePicker`. Otherwise the label.
3. Branch, timing (started, completed, or running duration), origin (`objectiveOriginLabel`).
4. Run Queue: status line and a button that opens `ObjectiveQueuePopover`, anchored to a trigger inside the detail. Menu-launched queue controls also use a detail-local anchor, never a row behind the modal.
5. Terminal session, when the objective has one: state dot and label, "Open in Latch", "End session" (the controls from `TerminalSessionCard` / `ObjectiveTerminalSessions`).
6. Primary action by state:
   - `draft`, `submitted`, `launching`: `AgentLaunchButton` (split Run with Copy prompt and Copy CLI command), with its existing parallel-launch guard. It needs `siblings`, `executionRequests` and `allowParallelObjectives`, which the detail receives from the mission.
   - `executing`: "Force disconnect".
   - otherwise none.

### 9.5 Body, below 768px

One scrolling column, per the mobile artboard:

- Top bar: a back button labelled with the mission title (closes the detail), "n of m", the objective menu.
- Identifier, state badge, title, then the right column's read-only metadata folded into one wrapping line (agent icon and model, resource, branch, timing).
- Then the left column's content in the same order as 9.4. File rows show the file name with its directory dimmed beneath.
- Fixed bottom bar: previous, the primary action for the state (Run, or "Open in Latch" when there is a session), next. Previous and next use left and right chevrons here. Controls that have no room (End session, Force disconnect, Run Queue, resource and agent pickers for a draft) are reached from the menu or from a "Details" disclosure under the metadata line.
- All targets at least 44px.

### 9.6 Summary and Instructions tabs

- A hand-rolled `role="tablist"` (there is no Tabs primitive; follow `pages/MissionsViewToggle.tsx`), with arrow-key movement between the two tabs. Visually subtle: the labels use the existing small uppercase section-label style, the selected one in ink with a hairline underline, the other dimmed.
- Order: Summary, then Instructions. Summary is selected whenever a detail opens or the objective changes.
- Summary tab: `ObjectiveSummaryBody` (prose plus its edit, regenerate and remove controls), using the body text style the instructions use.
- Instructions tab: not started: the `InlineEditField` instruction editor from `DraftObjective` (multiline, `@`/`#`/`$` mentions, emptying it deletes only when `shouldDiscardEmptiedObjective` permits it, preserving draft-only empty commits and attachment/history guards; close only after deletion succeeds). Otherwise read-only text.
- When `objective.description` is null there is no tab row: show the instructions, followed by `ObjectiveSummaryFallback` (Summarize, pending and failed states) where it applies today.
- `descriptionStale`, `descriptionStatus` and `descriptionSuppressed` are presented by the reused summary components exactly as today.

### 9.7 Blocking questions list

New `ObjectiveBlockingQuestions.tsx` in the detail directory.

- Rendered only when this objective has at least one open `question` or `choice` request (`isPendingBlockingRequest`). With none, the section and its heading are absent; answered, expired and cancelled requests are not listed.
- Source: the shared complete open-request collection from 3.1/3.2, grouped by objective ID. Preserve its loading/error/completeness state; no independent polling cache should disagree with the mission view.
- Heading "Blocking questions". One row per open request, oldest first: relative time, the first line of the question, and an "Answer" label on the right. Each row is a `<button aria-expanded>` with the same solid yellow as a blocked objective row.
- Clicking the disclosure button reveals a sibling body (never nest answer controls inside the button) containing the full blocking panel: the existing `BlockingQuestionCard` / choice card with its answer form, countdown, read-only reason and delivery state. Clicking again collapses it. Expanded state is local to the detail.
- A row is shown whether or not that request's top card was dismissed. While the top card is still showing, the row starts collapsed, so the form is not on screen twice.
- When the detail opens on an objective whose only open requests have all been dismissed, the list is scrolled into view and its first row starts expanded.
- When a request is answered or expires, its row is removed; when the last one goes, the section disappears.

### 9.8 Edit lifecycle, failures and focus

- Keep title, instruction and existing summary drafts keyed by objective ID. Never reuse an active editor's buffer for a different objective. Switching tabs, previous/next, closing, browser navigation, Run and realtime state transitions must not lose keystrokes or pending uploads. A summary arriving mid-edit must not unmount or obscure that editor.
- Centralize an awaitable flush/save boundary before intentional navigation and Run; launching uses the saved instruction and current launch guards. The existing `InlineEditField` unmount cleanup only cancels its timer, and its void `onSave` does not establish completion. Adapt the editor/controller API rather than relying on blur or debounce to complete before navigation.
- On save/delete failure retain the correct objective's text, show the error and a retry affordance, and keep the detail open for intentional UI close/navigation. Intercept in-app history navigation where supported; if the surface must unmount, retain the keyed pending draft for restoration. Handle a concurrent state change/delete explicitly; do not save an old buffer against a new objective or silently discard it.
- Initial focus goes to the requested title editor for Edit title, otherwise a stable dialog heading/control. Return focus to the invoking row/link on close, or the objective-list heading when that row was deleted. Preserve mission scroll and selected tab. Nested menus, confirmation dialogs and popovers own their focus and first Escape before the outer dialog.
- Tabs have linked tab/tabpanel IDs, roving keyboard focus and arrow-key behavior. Expanding a blocking question leaves its form outside the trigger button. Test keyboard title editing, form submission, modal-local queue actions and desktop-shell entry/return.

## 10. Latch access in the header

- New `MissionLatchChip` in `components/ObjectiveTerminalSessions.tsx`, rendered in `MissionPanelHeaderBar` before the due-date control.
- Shown only when the mission has a current session (the same `current` selection `MissionTerminalSessionsSection` computes, after the provider's absent-session filtering).
- Appearance: a pill with the session's state dot, a terminal icon and "Latch · <state>". When the panel is narrower than about 480px the text is hidden and only the dot and icon remain (container query on the panel root), because the header already holds the due date, timer, branch control and close button at a 375px minimum.
- Click opens a `Popover` containing what `MissionTerminalSessionsSection` renders today: the current `TerminalSessionCard` (Open in Latch, End session, reachability line, errors) and the `PreviousLatchSessionsAccordion`. The explanatory sentence under the old heading becomes the popover's first line.
- Delete `MissionTerminalSessionsSection` as a panel section once the popover replaces it.
- `MissionLatchSessionProvider` keeps tracking every running session whether or not the popover is open.

## 11. Work breakdown

Six ordered objectives on coo:1281, all assigned to Claude Code / Opus 5.5 (`claude-opus-5-5`). Execute sequentially. Earlier objectives run focused checks needed for their changes and mandatory contract checks when applicable; the final objective owns comprehensive automated and interactive verification of the whole plan.

| Order | Objective | Scope |
| --- | --- | --- |
| 1 | `coo:1281.rxzn` | Complete open-request API and client collection |
| 2 | `coo:1281.ar07` | Shared controls and compact rows |
| 3 | `coo:1281.qwdx` | Objective detail, editing and navigation |
| 4 | `coo:1281.w8zz` | Overview, questions and composer |
| 5 | `coo:1281.b77g` | Latch header and integration cleanup |
| 6 | `coo:1281.8xx9` | Comprehensive verification and fixes |

These objectives are created as drafts with auto-advance off; creating them does not launch execution.

1. **Complete open-request API and client collection** — section 3.1: compatible filtered pagination, authorization, contract/OpenAPI/generated artifacts, coherent client collection and focused boundary checks. Code and contract land together. Contract impact: minor.
2. **Shared objective controls and compact rows** — sections 6.3 and 7: icon, queue popover, unified menus, agent trigger variant, row ordering, optimistic reorder, drag/touch/keyboard behavior. Keep existing callers usable until integration. Contract impact: none; client presentation uses existing interfaces.
3. **Objective detail and navigation** — all of section 9 and feed/summary links: responsive modal, evidence/attachments, launch/session controls, safe edit lifecycle, shared navigation/history and accessibility. Reuse the complete request collection. Contract impact: none; preserve API and data semantics.
4. **Overview, blocking questions and sticky composer** — sections 4–6 and 8: panel integration, scoped persistent dismissal, eligibility-independent For you, visibility/coverage-gated acknowledgement, tab counts and composer persistence. Contract impact: none; retain existing seen-data meaning.
5. **Latch header and final integration cleanup** — section 10 and remaining integration: provider placement, header sizing, mobile controls, retire replaced components/helpers, reconcile all callers and finish the complete design. Contract impact: none; no new session interfaces.
6. **Comprehensive verification and fixes** — all of section 14, across the complete implementation. Run full automated checks and real browser/desktop interaction passes, fix defects found, record exact evidence and any unavailable environments. Expected contract impact: none for verification; classify any fix that changes the contract and land code/contract together. No publishing or deployment.

### 11.1 Files

New:

- `webapp/web/components/mission-panel/MissionBlockingQuestions.tsx`
- `webapp/web/components/mission-panel/MissionOverviewCard.tsx`
- `webapp/web/components/objectives/ObjectiveRow.tsx`
- `webapp/web/components/objectives/ObjectiveStateIcon.tsx`
- `webapp/web/components/objectives/ObjectiveQueuePopover.tsx`
- `webapp/web/components/objectives/objective-row-dnd.ts`
- `webapp/web/components/objective-detail/ObjectiveDetail.tsx` and its parts (header, tabs, sidebar, mobile bar)
- tests beside each (section 14)

Changed:

- `webapp/web/components/MissionPanel.tsx` (structure, providers, detail mount)
- `webapp/web/components/MissionPanelHeader.tsx` (Latch chip)
- `webapp/web/components/ObjectiveTerminalSessions.tsx` (chip and popover; section removed)
- `webapp/web/components/objectives/MissionObjectivesSection.tsx` (rewritten around rows)
- `webapp/web/components/objectives/ObjectiveMenuButton.tsx` (unified menu)
- `webapp/web/components/objectives/AgentModelChooserButton.tsx` (icon-only trigger variant)
- `webapp/web/components/objectives/ObjectiveEvidenceSections.tsx` (`layout="detail"`)
- `webapp/web/components/objectives/GhostObjective.tsx` (border and shadow; no dashed outline)
- `webapp/web/components/activity-feed/MissionRunCard.tsx` (shared state icon and separate mission/objective navigation)
- `webapp/web/components/mission-summary/MissionSummarySection.tsx` (logic moves into the overview card; keep the file only if the split stays clean, otherwise fold it in)
- `webapp/web/lib/mission-panel-search.ts` and `components/mission-summary/MissionSummaryParts.tsx` (shared navigation/history)
- `webapp/web/lib/dismissed-agent-requests.ts` (new scoped persistence store)
- `webapp/web/components/objective-detail/ObjectiveBlockingQuestions.tsx` and objective-keyed edit controller/buffer helpers
- `webapp/web/components/InlineEditField.tsx` (awaitable edit lifecycle and keyboard trigger where shared)
- `webapp/web/lib/hooks/use-mission-summary-seen.ts`, `lib/mission-summary-derive.ts`, summary tab child components and shared tone map
- `webapp/web/lib/queries/missions.ts`, request API client and query keys (complete filtered pagination and invalidation)
- `backend/agent-session-routes.ts` and focused route/boundary tests
- `contract/api/openapi.yaml`, affected contract prose/ADR and version/changelog files through the version command; generated API types/validators/operation artifacts
- SQLite/PostgreSQL test fixtures as needed; no eligibility migration is planned

Deleted:

- `webapp/web/components/objectives/ObjectiveCollapsibleItem.tsx`
- `webapp/web/components/objectives/DraftObjective.tsx`, `DraftObjectiveToolbar.tsx` and `DraftObjectiveActions.tsx`, once the editor, queue popover and menu pieces they contain have moved
- `SortableQueuedObjective`, `ObjectiveFocusAnchor` and the "+ Add objective" button inside `MissionObjectivesSection.tsx`
- per-row dismissal state for blocking requests; `selectObjectiveBlockingRequests`' `dismissedIds` input becomes unused (keep the pure helpers that are still called, delete the rest with their tests)

Preserve unrelated concurrent edits, including contract/backend changes and Overlord-managed `.overlord/project.json`. Modify only the scoped implementation and its required contract artifacts.

## 12. Differences from the canvas

| Canvas | Implementation |
| --- | --- |
| Two-letter monogram agent marks | the real `AgentIcon` assets |
| "Queued" as a state | the queue button appears for any objective with a Run Queue entry, in any state |
| Agent selector on "draft" rows only | on `draft` and `submitted` rows |
| Reorder limited to three sample drafts | every `draft` and `submitted` objective, the set the reorder route requires |
| Hand-rolled press-and-hold | `@dnd-kit` sensors with a 250ms hold |
| Panel drawn 620px wide | must work from 375px to 640px (the drawer's range) |
| Tab rows use simplified sample rows and marks | the real summary components render inside each tab |
| Hover icon uses pointer events | CSS `group-hover` / `group-focus-within` |
| Blocking questions list uses one sample question | the objective's real open requests (9.7) |
| Menu lacks Move up / Move down and Force disconnect | added (keyboard reordering; replaces the removed row icon) |
| Mobile bar uses up and down arrows | left and right chevrons |

## 13. Product decisions

Decided on 2026-11-16:

1. **Title editing.** A person can edit an objective's title. The existing route already supports it (3.1).
2. **Dismissing a blocking question.** The notification at the top of the mission panel and of the objective detail can be dismissed. The open question stays in the body of the objective detail, in a Blocking questions list that appears only when the objective has at least one open blocking question; each yellow highlighted item expands into the full blocking panel (sections 5, 9.4, 9.7). The detail has no Activity list.
3. **Feed navigation.** The main feed card opens the mission. An individual objective row on the card opens that objective (9.1).
4. **Mouse hold delay.** 250ms for now.
5. **Summary sub-sections.** They are tabs, colour-coded with the summary's existing colours; the selected tab replaces the objective list in the card's lower half (6.2).
6. **Unqueued objectives.** Queued objectives keep the green queue icon. Objectives that are not queued show a grey queue icon on hover only (7.2 #4).
7. **Contract size.** Not a constraint; add what a decided behaviour needs.
8. **Narrow viewports.** The panels are simply layered: the mission panel stays as it is, and opening an objective places the objective detail over it (9.2, 9.5). There is no separate full-screen redesign of the mission panel.
9. **Tab labels.** "For you", "Suggested" and "Files" (6.2).
10. **Composer.** Shown on every tab; the layout guarantees the bottom of the selected tab can always be scrolled into view above it (section 8).

11. **Complete questions.** Add filtered pagination rather than accept the current 200-request blind spot; preserve existing callers.
12. **Unread evidence.** Hidden evidence remains new on the next visit. Use the conservative displayed-coverage gate in 6.1, preserving existing seen-data semantics.
13. **Eligibility.** Open questions appear in For you even for older summary-ineligible missions. Summary eligibility itself is unchanged.
14. **History.** Explicit Close reveals the mission; browser Back follows actual history, including returning to the previous page on direct/feed entry.
15. **Editing and accessibility.** Preserve keyed drafts and surface save failures; first Escape cancels the editor/popup, subsequent Escape closes the detail. Provide keyboard editing and predictable focus return.
16. **Execution.** Use six ordered Opus 5.5 objectives with comprehensive testing in the final objective.

No PM questions remain open.

## 14. Tests and verification

Runner: `node:test` with `@testing-library/react` (`yarn test:webapp`). There is no browser end-to-end suite, so the interaction checks at the end are manual.

Update:

- `components/objectives/objective-summary.test.tsx`: its queue-head, compact-card and executed-row cases are rewritten against rows and the detail; the summary state and action cases move to the detail's Summary tab.
- `components/objectives/GhostObjective.test.tsx`: the composer is always present; the committing-objective case still hides the row until hand-over.
- `components/mission-summary/MissionSummarySection.test.tsx`: retargeted at the overview card, covering all five summary states.
- `lib/objective-blocking-requests.test.ts`: drop dismissal cases if the input is removed.

Add:

- `ObjectiveRow`: each state renders the right icon; the queued button is always visible and amber when queue-blocked, while an unqueued not-started objective has the hover/focus add button; the identifier button copies the full id and shows "Copied"; the agent icon is a button only when not started; none of the row's buttons opens the detail; the menu shows the right items per state (table in 7.2 #7).
- `MissionObjectivesSection`: order across groups; Move up / Move down send the complete not-started set; a failed reorder rolls back; executed and launching rows are not sortable.
- `MissionBlockingQuestions`: renders per open request, oldest first; collapses beyond two; disappears when resolved; the objective id opens the detail; dismissing hides the card but leaves the row tint and the "For you" row; a new request id shows again; dismissal survives a remount.
- `MissionOverviewCard`: badge selection; Objectives selected by default; zero-count tabs hidden; selecting a tab swaps the lower half; selection returns to Objectives when its count reaches zero; the composer is present on every tab and keeps its text across a tab change; ineligible missions still list objectives and show For you when open questions exist, including after their notification is dismissed.
- `ObjectiveBlockingQuestions`: absent with no open request; one highlighted button per open request that expands to the answer form; present when the top card was dismissed; a row disappears once answered and the section with the last row.
- Feed (`MissionRunCard`): the header opens the mission without an objective; an objective row opens it with that objective.
- `ObjectiveRow` queue button: emerald and always visible when queued; present but hidden until hover or focus when not started and not queued; absent otherwise.
- `ObjectiveDetail`: opens from `?objective=`; unknown value is cleared; previous and next follow row order; Summary is selected on open and on objective change; no tab row when there is no summary; instruction editing only when not started; emptying only an eligible empty draft deletes and closes after success; attachments/history prevent unintended deletion; the primary action per state; editor/popup Escape does not close the detail, dialog-level Escape and explicit close remove the parameter with correct history semantics.
- `MissionLatchChip`: hidden without a current session; popover holds the current card and previous sessions.
- `lib/mission-panel-search.test.ts`: the new set and clear helpers.

Comprehensive regression coverage in the final objective:

- Request API in both database editions: an old open request behind more than 200 newer resolved requests; more than one page of open requests; identical timestamps; arrivals/resolutions during pagination; pending-delivery objectives; optional objective filtering; workspace authorization and cursor scope; unchanged legacy unfiltered callers.
- Shared request query: complete/partial/error/retry states, answer invalidation and simultaneous mission/detail consistency; failures do not falsely clear blocked state or authorize pruning.
- Dismissal: mission A → B → A, reload while loading, failed and truncated queries, account/backend switching, unavailable storage and new request IDs.
- Seen markers: never open For you/Risks and revisit; foreground two-second display, new evidence while reading, covered versus uncovered snapshots, modal occlusion, partial/error states and summary-ineligible missions. No acknowledgement of hidden evidence.
- Editors: type then immediately switch tab/objective, close, Back or Run; rejected save/delete; realtime summary/state changes; attachments/history on empty draft; correct objective IDs; buffers and pending uploads survive; no duplicate mutation or launch with stale instructions.
- Navigation: direct/copy/feed/summary/row entry, UUID compatibility, close-then-Back, previous/next replacement, Back/Forward, invalid parameter after successful loading, loading/error preservation, deleted-objective fallback and desktop-shell navigation.
- Accessibility: keyboard title editing, linked tabs, nested confirmation/queue popovers, no nested form-in-button, Escape precedence, initial/return focus, deleted trigger and screen-reader names.

Full checks in the final objective:

- `yarn lint`, `yarn typecheck:webapp`, `yarn test:webapp`, `yarn webapp:build:prod`.
- `yarn check`, `yarn contract:check`, `yarn contract:test`, `yarn api:generate:check`, `yarn contract:parity`, `yarn check:conformance-versions`, and the relevant complete backend/database suites (`yarn test:backend` plus the repository-supported SQLite/PostgreSQL coverage). Run required checks once after the integrated implementation and repeat affected checks after fixes. Report environment failures separately from defects; do not claim unavailable checks passed.

Manual pass, in the running app, light and dark, at 375px, 420px and 640px panel widths and with the window under 768px:

1. A mission with an open question: the card is under the title; answering clears it and the row tint together.
2. A mission with more objectives than fit: the composer floats, then settles at the end of the list; its popups open upward.
3. Quick click opens the detail; hold and drag reorders with mouse and with touch (a real touch device or emulation); releasing a drag does not open the detail; a swipe on a row scrolls the panel.
4. Each row control in each state, per section 7.2.
5. Detail for a not-started, launching, executing, blocked, pending-delivery and complete objective; Run launches saved instructions from the detail; Back and explicit Close follow 9.1, with drafts preserved.
6. Latch chip and popover with a running session, a stopped session, and none; the header does not overflow at 375px.
7. A mission that is not summary-eligible, a mission before its first delivery, and a mission with no objectives.
8. A feed card link and a copied `?objective=` link.

9. Browser and native desktop shell entry/return, keyboard-only navigation and nested menus/dialogs; check initial/return focus and Latch actions.
10. Full-screen detail at 375px, 640px and 767px, including software keyboard and safe-area insets; no inherited translation/max-width clipping. Verify 768px switches to desktop layout.
11. Every overview tab with short and long content and a tall composer; the last item remains reachable.
12. Compare against the design canvas if accessible; otherwise record that visual-source limitation explicitly while checking every specified layout and interaction.

The final delivery distinguishes automated, browser/touch, native desktop and visual-source evidence. Fix discovered regressions before delivery where possible; report any concrete environment blocker and unverified acceptance case. Implementation and local verification do not imply deployment.
